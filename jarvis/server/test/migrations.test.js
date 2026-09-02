const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listMigrationFiles, runMigrations } = require('../src/db/migrate');

test('migration files are ordered and narrowly named', () => {
  const files = listMigrationFiles();
  assert.deepEqual(files, [
    '001_identity_and_conversations.sql',
    '002_assistant_domain.sql',
    '003_desktop_cloud_client.sql',
    '004_private_knowledge_base.sql',
    '005_embeddings_and_command_lifecycle.sql',
    '006_action_orchestrator.sql',
  ]);
});

test('migration runner locks, parameterizes names, and commits', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-migrations-'));
  fs.writeFileSync(path.join(directory, '001_first.sql'), 'SELECT 42;', 'utf8');
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).trim(), params });
      if (String(sql).includes('SELECT 1 FROM schema_migrations')) return { rowCount: 0 };
      return { rowCount: 1 };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };

  try {
    await runMigrations({ async connect() { return client; } }, { directory });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  assert.ok(calls.some((call) => call.sql === 'SELECT 42;'));
  assert.ok(calls.some((call) => call.sql.startsWith('INSERT INTO schema_migrations') && call.params[0] === '001_first.sql'));
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('migration runner rolls back and releases on failure', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = String(sql).trim();
      calls.push(normalized);
      if (normalized.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) throw new Error('database unavailable');
      return { rowCount: 0 };
    },
    release() { calls.push('RELEASE'); },
  };

  await assert.rejects(
    runMigrations({ async connect() { return client; } }),
    /database unavailable/,
  );
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'RELEASE']);
});
