const { Pool } = require('pg');
require('dotenv').config();

// Single shared connection pool used by every route in the app.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;
