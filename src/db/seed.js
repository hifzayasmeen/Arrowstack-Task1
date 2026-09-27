// Seeds one admin account, one sample buyer, and a handful of products
// so the app is immediately demoable after `npm run migrate && npm run seed`.
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    const adminPassword = await bcrypt.hash('Admin@123', 10);
    const buyerPassword = await bcrypt.hash('Buyer@123', 10);

    await client.query(
      `INSERT INTO users (name, email, password_hash, role, company_name)
       VALUES ($1, $2, $3, 'admin', $4)
       ON CONFLICT (email) DO NOTHING`,
      ['Platform Admin', 'admin@arrowstack.test', adminPassword, 'Arrowstack Distribution']
    );

    await client.query(
      `INSERT INTO users (name, email, password_hash, role, company_name)
       VALUES ($1, $2, $3, 'buyer', $4)
       ON CONFLICT (email) DO NOTHING`,
      ['Sample Buyer', 'buyer@arrowstack.test', buyerPassword, 'Retail Partner Co.']
    );

    const products = [
      ['SKU-1001', 'Corrugated Shipping Boxes (Pack of 25)', 'Standard 18x18x18in boxes for bulk shipping.', 24.99, 500],
      ['SKU-1002', 'Industrial Pallet Wrap Roll', '20in x 1000ft stretch film, 80 gauge.', 18.5, 300],
      ['SKU-1003', 'Barcode Label Rolls (2000 labels)', 'Thermal transfer labels, 4x6in.', 32.0, 150],
      ['SKU-1004', 'Heavy-Duty Packing Tape (Case of 36)', '2in x 110yd clear tape, acrylic adhesive.', 45.75, 200],
      ['SKU-1005', 'Anti-Static Bubble Wrap (250ft Roll)', 'Protects sensitive electronic components.', 60.0, 80],
    ];

    for (const [sku, name, description, unit_price, stock_qty] of products) {
      await client.query(
        `INSERT INTO products (sku, name, description, unit_price, stock_qty)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sku) DO NOTHING`,
        [sku, name, description, unit_price, stock_qty]
      );
    }

    console.log('Seed complete.');
    console.log('Admin login: admin@arrowstack.test / Admin@123');
    console.log('Buyer login: buyer@arrowstack.test / Buyer@123');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
