const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_STATUSES = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];

// GET /api/orders — buyers see only their own orders; admins see everyone's.
// Supports ?limit=&offset= (defaults keep the response shape and size
// sane as order volume grows; the response stays a plain array so the
// existing frontend needs no changes).
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    const query =
      req.user.role === 'admin'
        ? `SELECT o.*, u.name AS buyer_name, u.company_name
           FROM orders o JOIN users u ON u.id = o.buyer_id
           ORDER BY o.created_at DESC
           LIMIT $1 OFFSET $2`
        : `SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    const params = req.user.role === 'admin' ? [limit, offset] : [req.user.id, limit, offset];

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

// GET /api/orders/:id — includes line items and invoice; buyers can only view their own.
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (req.user.role !== 'admin' && order.buyer_id !== req.user.id) {
      return res.status(403).json({ error: 'You cannot view this order.' });
    }

    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    const invoiceResult = await pool.query('SELECT * FROM invoices WHERE order_id = $1', [order.id]);

    res.json({ ...order, items: itemsResult.rows, invoice: invoiceResult.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load order.' });
  }
});

// PATCH /api/orders/:id/status — admin only, moves an order through its lifecycle.
router.patch('/:id/status', requireRole('admin'), async (req, res) => {
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found.' });

    await logAction({
      userId: req.user.id,
      action: 'update_status',
      entity: 'order',
      entityId: rows[0].id,
      details: { newStatus: status },
    });

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update order status.' });
  }
});

module.exports = router;
