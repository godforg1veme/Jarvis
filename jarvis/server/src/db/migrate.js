const fs = require('fs');
const path = require('path');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function listMigrationFiles(directory = DEFAULT_MIGRATIONS_DIR) {
  return fs.readdirSync(directory)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
}

async function runMigrations(pool, options = {}) {
  const directory = options.directory || DEFAULT_MIGRATIONS_DIR;
  const files = listMigrationFiles(directory);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const name of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (exists.rowCount > 0) continue;
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  listMigrationFiles,
  runMigrations,
};
