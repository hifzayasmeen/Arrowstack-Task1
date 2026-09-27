// Integration test suite for the B2B Order Management API.
//
// Runs against a real PostgreSQL database (the same one migrations/seed
// use) so the checkout transaction, stock locking, and constraints are
// exercised for real rather than mocked. Uses Node's built-in test
// runner — no extra test framework dependency.
//
// Prerequisites: `npm run migrate && npm run seed` against the target
// DATABASE_URL before running `npm test`.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

const app = require('../src/app');
const pool = require('../src/db/pool');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0); // ephemeral port avoids clashing with a dev server
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://localhost:${port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}

// Unique suffix per test run so re-running tests never collides on
// unique constraints (email, SKU).
const RUN_ID = Date.now();

describe('Health check', () => {
  test('GET /health returns ok', async () => {
    const { status, body } = await api('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });
});

describe('Auth', () => {
  test('rejects registration with an invalid email', async () => {
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Bad Email', email: 'not-an-email', password: 'password123' },
    });
    assert.equal(status, 400);
    assert.match(body.error, /valid email/i);
  });

  test('rejects registration with a short password', async () => {
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Short Pw', email: `shortpw${RUN_ID}@test.com`, password: '123' },
    });
    assert.equal(status, 400);
    assert.match(body.error, /8 characters/i);
  });

  test('registers a new buyer and returns a token', async () => {
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: { name: 'New Buyer', email: `buyer${RUN_ID}@test.com`, password: 'password123' },
    });
    assert.equal(status, 201);
    assert.ok(body.token);
    assert.equal(body.user.role, 'buyer'); // self-registration can never create an admin
  });

  test('rejects duplicate email registration', async () => {
    const email = `dupe${RUN_ID}@test.com`;
    await api('/auth/register', { method: 'POST', body: { name: 'A', email, password: 'password123' } });
    const { status, body } = await api('/auth/register', {
      method: 'POST',
      body: { name: 'B', email, password: 'password123' },
    });
    assert.equal(status, 409);
    assert.match(body.error, /already exists/i);
  });

  test('rejects login with wrong password', async () => {
    const { status } = await api('/auth/login', {
      method: 'POST',
      body: { email: 'buyer@arrowstack.test', password: 'wrong-password' },
    });
    assert.equal(status, 401);
  });

  test('logs in seeded admin and buyer accounts', async () => {
    const admin = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@arrowstack.test', password: 'Admin@123' },
    });
    const buyer = await api('/auth/login', {
      method: 'POST',
      body: { email: 'buyer@arrowstack.test', password: 'Buyer@123' },
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.user.role, 'admin');
    assert.equal(buyer.status, 200);
    assert.equal(buyer.body.user.role, 'buyer');
  });
});

describe('Role-based access control', () => {
  test('rejects requests with no token', async () => {
    const { status } = await api('/products');
    assert.equal(status, 401);
  });

  test('buyer cannot create a product', async () => {
    const { body: login } = await api('/auth/login', {
      method: 'POST',
      body: { email: 'buyer@arrowstack.test', password: 'Buyer@123' },
    });
    const { status, body } = await api('/products', {
      method: 'POST',
      token: login.token,
      body: { sku: `HACK-${RUN_ID}`, name: 'Should not be created', unitPrice: 1, stockQty: 1 },
    });
    assert.equal(status, 403);
    assert.match(body.error, /permission/i);
  });

  test('admin can create a product', async () => {
    const { body: login } = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@arrowstack.test', password: 'Admin@123' },
    });
    const { status, body } = await api('/products', {
      method: 'POST',
      token: login.token,
      body: { sku: `ADMIN-CREATE-${RUN_ID}`, name: 'Admin Created Product', unitPrice: 5, stockQty: 10 },
    });
    assert.equal(status, 201);
    assert.equal(body.sku, `ADMIN-CREATE-${RUN_ID}`);
  });
});

describe('Product validation', () => {
  let adminToken;

  before(async () => {
    const { body } = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@arrowstack.test', password: 'Admin@123' },
    });
    adminToken = body.token;
  });

  test('rejects a negative price', async () => {
    const { status, body } = await api('/products', {
      method: 'POST',
      token: adminToken,
      body: { sku: `NEGPRICE-${RUN_ID}`, name: 'Bad Price', unitPrice: -5, stockQty: 10 },
    });
    assert.equal(status, 400);
    assert.match(body.error, /non-negative/i);
  });

  test('rejects a duplicate SKU', async () => {
    const sku = `DUPE-SKU-${RUN_ID}`;
    await api('/products', { method: 'POST', token: adminToken, body: { sku, name: 'First', unitPrice: 1, stockQty: 1 } });
    const { status, body } = await api('/products', {
      method: 'POST',
      token: adminToken,
      body: { sku, name: 'Second', unitPrice: 1, stockQty: 1 },
    });
    assert.equal(status, 409);
    assert.match(body.error, /already exists/i);
  });
});

describe('Cart and checkout (core transaction)', () => {
  let adminToken;
  let buyerToken;
  let productId;

  before(async () => {
    const admin = await api('/auth/login', { method: 'POST', body: { email: 'admin@arrowstack.test', password: 'Admin@123' } });
    adminToken = admin.body.token;

    const buyerEmail = `checkout-buyer-${RUN_ID}@test.com`;
    const buyer = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Checkout Tester', email: buyerEmail, password: 'password123' },
    });
    buyerToken = buyer.body.token;

    const product = await api('/products', {
      method: 'POST',
      token: adminToken,
      body: { sku: `CHECKOUT-${RUN_ID}`, name: 'Checkout Test Widget', unitPrice: 10, stockQty: 3 },
    });
    productId = product.body.id;
  });

  test('rejects adding more to cart than is in stock', async () => {
    const { status, body } = await api('/cart', {
      method: 'POST',
      token: buyerToken,
      body: { productId, quantity: 999 },
    });
    assert.equal(status, 409);
    assert.match(body.error, /stock/i);
  });

  test('rejects checkout with an empty cart', async () => {
    const { status, body } = await api('/cart/checkout', { method: 'POST', token: buyerToken });
    assert.equal(status, 400);
    assert.match(body.error, /empty/i);
  });

  test('completes checkout, decrements stock, and generates an invoice', async () => {
    const add = await api('/cart', { method: 'POST', token: buyerToken, body: { productId, quantity: 2 } });
    assert.equal(add.status, 201);

    const checkout = await api('/cart/checkout', { method: 'POST', token: buyerToken });
    assert.equal(checkout.status, 201);
    assert.equal(Number(checkout.body.order.total_amount), 20); // 2 x $10
    assert.ok(checkout.body.invoice.invoice_number.startsWith('INV-'));

    const product = await api(`/products/${productId}`, { token: adminToken });
    assert.equal(product.body.stock_qty, 1); // 3 - 2 = 1 remaining

    const cart = await api('/cart', { token: buyerToken });
    assert.deepEqual(cart.body, []); // cart cleared after checkout
  });

  test('a second buyer cannot oversell the last unit', async () => {
    // Only 1 unit left from the previous test.
    const { status, body } = await api('/cart', {
      method: 'POST',
      token: buyerToken,
      body: { productId, quantity: 2 },
    });
    assert.equal(status, 409);
    assert.match(body.error, /stock/i);
  });

  test('buyer cannot view another buyer\'s order', async () => {
    const orders = await api('/orders', { token: buyerToken });
    const orderId = orders.body[0].id;

    const otherBuyer = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Other Buyer', email: `other-${RUN_ID}@test.com`, password: 'password123' },
    });

    const { status } = await api(`/orders/${orderId}`, { token: otherBuyer.body.token });
    assert.equal(status, 403);
  });

  test('admin can move an order through its status lifecycle', async () => {
    const orders = await api('/orders', { token: buyerToken });
    const orderId = orders.body[0].id;

    const updated = await api(`/orders/${orderId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'processing' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'processing');
  });

  test('rejects an invalid status value', async () => {
    const orders = await api('/orders', { token: buyerToken });
    const orderId = orders.body[0].id;

    const { status, body } = await api(`/orders/${orderId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'teleported' },
    });
    assert.equal(status, 400);
    assert.match(body.error, /must be one of/i);
  });
});
