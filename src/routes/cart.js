const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

const router = express.Router();

// All cart routes are buyer-only — admins manage the catalog, not a cart.
router.use(requireAuth, requireRole('buyer'));

// GET /api/cart — current buyer's cart with product details and line totals.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.unit_price, p.stock_qty,
              (ci.quantity * p.unit_price) AS line_total
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.buyer_id = $1
       ORDER BY ci.created_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load cart.' });
  }
});

// POST /api/cart — add an item, or increase quantity if it's already in the cart.
router.post('/', async (req, res) => {
  const { productId, quantity } = req.body;
  const qty = Number(quantity);

  if (!productId || !qty || qty <= 0) {
    return res.status(400).json({ error: 'productId and a positive quantity are required.' });
  }

  try {
    const productResult = await pool.query(
      'SELECT id, stock_qty, is_active FROM products WHERE id = $1',
      [productId]
    );
    const product = productResult.rows[0];
    if (!product || !product.is_active) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    if (product.stock_qty < qty) {
      return res.status(409).json({ error: `Only ${product.stock_qty} units in stock.` });
    }

    const { rows } = await pool.query(
      `INSERT INTO cart_items (buyer_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (buyer_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [req.user.id, productId, qty]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add item to cart.' });
  }
});

// PUT /api/cart/:id — set a cart line to an exact quantity.
router.put('/:id', async (req, res) => {
  const qty = Number(req.body.quantity);
  if (!qty || qty <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE cart_items SET quantity = $1
       WHERE id = $2 AND buyer_id = $3
       RETURNING *`,
      [qty, req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cart item not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update cart item.' });
  }
});

// DELETE /api/cart/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM cart_items WHERE id = $1 AND buyer_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cart item not found.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not remove cart item.' });
  }
});

// POST /api/cart/checkout — the core business transaction:
// validate stock -> create order + order_items -> decrement stock ->
// generate invoice -> clear cart. All inside one DB transaction so a
// failure partway through leaves no partial order behind.
router.post('/checkout', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cartResult = await client.query(
      `SELECT ci.id AS cart_item_id, ci.product_id, ci.quantity, p.name, p.unit_price, p.stock_qty
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.buyer_id = $1
       FOR UPDATE OF p`,
      [req.user.id]
    );
    const items = cartResult.rows;

    if (items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    // Validate every line has enough stock before committing to anything.
    const shortages = items.filter((item) => item.stock_qty < item.quantity);
    if (shortages.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Some items no longer have enough stock.',
        shortages: shortages.map((s) => ({ productId: s.product_id, name: s.name, available: s.stock_qty, requested: s.quantity })),
      });
    }

    const totalAmount = items.reduce((sum, item) => sum + item.quantity * Number(item.unit_price), 0);

    const orderResult = await client.query(
      `INSERT INTO orders (buyer_id, status, total_amount) VALUES ($1, 'pending', $2) RETURNING *`,
      [req.user.id, totalAmount]
    );
    const order = orderResult.rows[0];

    for (const item of items) {
      const lineTotal = item.quantity * Number(item.unit_price);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.product_id, item.name, item.unit_price, item.quantity, lineTotal]
      );
      await client.query('UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2', [item.quantity, item.product_id]);
    }

    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(order.id).padStart(5, '0')}`;
    const invoiceResult = await client.query(
      `INSERT INTO invoices (order_id, invoice_number, amount) VALUES ($1, $2, $3) RETURNING *`,
      [order.id, invoiceNumber, totalAmount]
    );

    await client.query('DELETE FROM cart_items WHERE buyer_id = $1', [req.user.id]);

    await client.query('COMMIT');

    await logAction({
      userId: req.user.id,
      action: 'checkout',
      entity: 'order',
      entityId: order.id,
      details: { totalAmount, itemCount: items.length },
    });

    res.status(201).json({ order, invoice: invoiceResult.rows[0], items });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Checkout failed. No charges were made.' });
  } finally {
    client.release();
  }
});

module.exports = router;
