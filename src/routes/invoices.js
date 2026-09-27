const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/invoices/:orderId — buyers can only fetch their own invoice.
router.get('/:orderId', async (req, res) => {
  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.orderId]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (req.user.role !== 'admin' && order.buyer_id !== req.user.id) {
      return res.status(403).json({ error: 'You cannot view this invoice.' });
    }

    const invoiceResult = await pool.query('SELECT * FROM invoices WHERE order_id = $1', [req.params.orderId]);
    if (invoiceResult.rows.length === 0) return res.status(404).json({ error: 'Invoice not found.' });

    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.orderId]);

    res.json({ invoice: invoiceResult.rows[0], order, items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load invoice.' });
  }
});

module.exports = router;
