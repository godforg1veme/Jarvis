const { Pool } = require('pg');

function createPool(config, options = {}) {
  if (!config || !config.databaseUrl) throw new Error('databaseUrl is required');
  return new Pool({
    connectionString: config.databaseUrl,
    max: options.max || 5,
    idleTimeoutMillis: options.idleTimeoutMillis || 30000,
    connectionTimeoutMillis: options.connectionTimeoutMillis || 5000,
    application_name: 'jarvis-family-server',
  });
}

function databaseReadinessCheck(pool) {
  async function database() {
    await pool.query('SELECT 1');
    return { name: 'database', ok: true };
  }
  return database;
}

module.exports = {
  createPool,
  databaseReadinessCheck,
};
