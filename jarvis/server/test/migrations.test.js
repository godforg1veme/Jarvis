const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } = require('../src/db/migrate');
const { LIFE_EVENT_TYPES, LINK_TARGET_TYPES, SOURCE_CHANNELS } = require('../src/life/lifeSchemas');

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
    '013_life_os_core.sql',
    '014_vpn_control.sql',
    '015_telegram_interactions.sql',
    '016_life_os_v2.sql',
    '017_life_os_reminders.sql',
    '018_life_os_proactivity_actions.sql',
  ]);
});

test('proactivity action migration preserves uncertain outcomes without retry coercion', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '018_life_os_proactivity_actions.sql'), 'utf8');
  assert.match(migration, /action_workflows_status_check/);
  assert.match(migration, /action_runs_status_check/);
  assert.match(migration, /'outcome_unknown'/);
  assert.doesNotMatch(migration, /DELETE|TRUNCATE|DROP TABLE/i);
});

test('reminder migration adds owner-scoped occurrence delivery and acknowledgement', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '017_life_os_reminders.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE life_reminder_deliveries/);
  assert.match(migration, /UNIQUE \(user_id, delivery_key\)/);
  assert.match(migration, /FOREIGN KEY \(user_id, reminder_id\) REFERENCES life_reminders\(user_id, id\)/);
  assert.match(migration, /'reminder\.acknowledged'/);
  assert.doesNotMatch(migration, /audio|image|ocr|body|local_path|storage_key|credential|token/i);
});

test('Life OS v2 migration adds owner-scoped domains without sensitive payload storage', () => {
  const migration = [
    fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '016_life_os_v2.sql'), 'utf8'),
    fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '017_life_os_reminders.sql'), 'utf8'),
  ].join('\n');
  for (const table of [
    'life_people',
    'life_person_relationships',
    'life_person_project_links',
    'life_family_access_grants',
    'life_modes',
    'life_preferences',
    'life_reminders',
    'life_recovery_plans',
    'life_recovery_steps',
    'life_source_connections',
    'life_source_cursors',
    'life_project_priority_state',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(migration, /FOREIGN KEY \(user_id, person_id\) REFERENCES life_people\(user_id, id\)/);
  assert.match(migration, /FOREIGN KEY \(user_id, project_id\) REFERENCES life_projects\(user_id, id\)/);
  assert.match(migration, /UNIQUE \(user_id, id\)/);
  assert.match(migration, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(migration, /claim_token uuid/);
  assert.match(migration, /life_reminders_due_claim_idx/);
  assert.match(migration, /target_type IN \([\s\S]*'person'[\s\S]*'reminder'[\s\S]*'recovery_plan'/);
  for (const value of [...LIFE_EVENT_TYPES, ...SOURCE_CHANNELS, ...LINK_TARGET_TYPES]) {
    assert.match(migration, new RegExp(`'${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
  assert.doesNotMatch(migration, /audio_bytes|image_data|ocr_text|document_body|email_body|local_path|storage_key|api_key|access_token|refresh_token|password/i);
});

test('Telegram interaction migration keeps guided input owner-scoped and bounded', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '015_telegram_interactions.sql'), 'utf8');
  assert.match(migration, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /conversation_id uuid NOT NULL REFERENCES conversations\(id\) ON DELETE CASCADE/);
  assert.match(migration, /octet_length\(convert_to\(context::text, 'UTF8'\)\) <= 1024/);
  assert.match(migration, /WHERE status = 'active'/);
  assert.doesNotMatch(migration, /credential|share_uri|audio|file_body|local_path/i);
});

test('Life OS migration keeps events and projections owner-scoped and bounded', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '013_life_os_core.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE life_events/);
  assert.match(migration, /UNIQUE \(user_id, deduplication_key\)/);
  assert.match(migration, /FOREIGN KEY \(user_id, event_id\) REFERENCES life_events\(user_id, id\)/);
  assert.match(migration, /octet_length\(convert_to\(structured_data::text, 'UTF8'\)\) <= 16384/);
  assert.match(migration, /CREATE TABLE life_proposal_evidence/);
  assert.doesNotMatch(migration, /audio_bytes|image_data|ocr_text|document_body|api_key|local_path/i);
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
