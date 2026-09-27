const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const { isNonNegativeNumber } = require('../utils/validation');

const router = express.Router();

// GET /api/products — any authenticated user (admin or buyer) can browse.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sku, name, description, unit_price, stock_qty, is_active
       FROM products
       WHERE is_active = TRUE
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

// GET /api/products/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load product.' });
  }
});

// POST /api/products — admin only
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { sku, name, description, unitPrice, stockQty } = req.body;

  if (!sku || !name || unitPrice == null || stockQty == null) {
    return res.status(400).json({ error: 'sku, name, unitPrice and stockQty are required.' });
  }
  if (name.length > 160 || sku.length > 60) {
    return res.status(400).json({ error: 'name or sku is too long.' });
  }
  if (!isNonNegativeNumber(Number(unitPrice)) || !isNonNegativeNumber(Number(stockQty))) {
    return res.status(400).json({ error: 'unitPrice and stockQty must be non-negative numbers.' });
  }
  if (!Number.isInteger(Number(stockQty))) {
    return res.status(400).json({ error: 'stockQty must be a whole number.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO products (sku, name, description, unit_price, stock_qty)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [sku, name, description || null, unitPrice, stockQty]
    );
    await logAction({ userId: req.user.id, action: 'create', entity: 'product', entityId: rows[0].id, details: req.body });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A product with this SKU already exists.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create product.' });
  }
});

// PUT /api/products/:id — admin only
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, description, unitPrice, stockQty, isActive } = req.body;

  if (unitPrice != null && unitPrice < 0) {
    return res.status(400).json({ error: 'unitPrice cannot be negative.' });
  }
  if (stockQty != null && stockQty < 0) {
    return res.status(400).json({ error: 'stockQty cannot be negative.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE products SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         unit_price = COALESCE($3, unit_price),
         stock_qty = COALESCE($4, stock_qty),
         is_active = COALESCE($5, is_active),
         updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, description, unitPrice, stockQty, isActive, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });

    await logAction({ userId: req.user.id, action: 'update', entity: 'product', entityId: rows[0].id, details: req.body });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update product.' });
  }
});

// DELETE /api/products/:id — admin only (soft delete via is_active)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });

    await logAction({ userId: req.user.id, action: 'delete', entity: 'product', entityId: rows[0].id });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete product.' });
  }
});

module.exports = router;
