const pool = require('../db/pool');

// Records who did what to which entity, and when. Never throws:
// a logging failure should never block the actual business operation.
async function logAction({ userId, action, entity, entityId, details }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, entity, entityId || null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { logAction };
