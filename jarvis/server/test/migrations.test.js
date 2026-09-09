const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } = require('../src/db/migrate');

test('migration files are ordered and narrowly named', () => {
  const files = listMigrationFiles();
  assert.deepEqual(files, [
    '001_identity_and_conversations.sql',
    '002_assistant_domain.sql',
    '003_desktop_cloud_client.sql',
    '004_private_knowledge_base.sql',
    '005_embeddings_and_command_lifecycle.sql',
    '006_action_orchestrator.sql',
    '007_operations_control_plane.sql',
    '008_operations_telemetry.sql',
    '009_operations_connections.sql',
    '010_operations_notification_delivery.sql',
    '011_operations_health_checks.sql',
    '012_visual_memory.sql',
  ]);
});

test('visual memory migration is owner-scoped and stores no plaintext scene or OCR payload', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '012_visual_memory.sql'), 'utf8');
  assert.match(migration, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /content_hash bytea NOT NULL CHECK \(octet_length\(content_hash\) = 32\)/);
  assert.match(migration, /visual_memory_tokens/);
  assert.doesNotMatch(migration, /scene_summary|ocr_text|image_data/);
});

test('operations migrations retain bounded, owner-safe storage contracts', () => {
  const migrations = ['007_operations_control_plane.sql', '008_operations_telemetry.sql', '009_operations_connections.sql']
    .map((name) => fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');
  assert.match(migrations, /browser_verifier_hash bytea NOT NULL CHECK \(octet_length\(browser_verifier_hash\) = 32\)/);
  assert.match(migrations, /credential_hash bytea NOT NULL UNIQUE CHECK \(octet_length\(credential_hash\) = 32\)/);
  assert.match(migrations, /knowledge_writes_paused/);
  assert.match(migrations, /device_kind text NOT NULL DEFAULT 'computer'/);
  assert.doesNotMatch(migrations, /messages\s+JOIN|document_chunks\s+JOIN/i);
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
