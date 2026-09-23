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
    '019_telegram_life_os_interactions.sql',
    '020_vpn_supervisor_advisory.sql',
    '021_vpn_probe_credentials.sql',
    '022_vpn_subscriptions.sql',
    '023_vpn_subscription_repair_action.sql',
    '024_telegram_update_outcomes.sql',
    '024_vpn_hysteria_port_pools.sql',
    '025_telegram_update_kind.sql',
    '025_vpn_hysteria_port_pool_hop_interval.sql',
  ]);
});

test('Hysteria port-pool interval correction is public-only and idempotent', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '025_vpn_hysteria_port_pool_hop_interval.sql'), 'utf8');
  assert.match(migration, /SET hop_interval_seconds = 30/);
  assert.match(migration, /AND hop_interval_seconds = 15/);
  assert.doesNotMatch(migration, /hostname|share_uri|password|credential|secret|token/i);
});

test('Hysteria port-pool migration stores only bounded public routing metadata', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '024_vpn_hysteria_port_pools.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS vpn_hysteria_port_pools/);
  assert.match(migration, /hop_interval_seconds SMALLINT NOT NULL CHECK \(hop_interval_seconds BETWEEN 5 AND 45\)/);
  assert.match(migration, /node_code IN \('de', 'nl'\)/);
  assert.doesNotMatch(migration, /hostname|share_uri|password|credential|secret|token/i);
});

test('Telegram update route migration retains only a closed route kind', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '025_telegram_update_kind.sql'), 'utf8');
  assert.match(migration, /update_kind IN \('message', 'callback'\)/);
  assert.match(migration, /telegram_updates_kind_idx/);
  assert.doesNotMatch(migration, /content|body|token|credential|secret/i);
});

test('Telegram update outcome migration stores only closed operational status and codes', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '024_telegram_update_outcomes.sql'), 'utf8');
  assert.match(migration, /status IN \('processing', 'completed', 'failed'\)/);
  assert.match(migration, /failure_code IS NULL OR failure_code ~ '\^\[A-Z\]\[A-Z0-9_\]\{2,79\}\$'/);
  assert.match(migration, /telegram_updates_failed_idx/);
  assert.doesNotMatch(migration, /message|content|body|token|credential|secret/i);
});

test('VPN subscription migration creates owner-scoped subscription table without sensitive secret storage', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '022_vpn_subscriptions.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS vpn_subscriptions/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /idx_vpn_subscriptions_token_hash/);
  assert.match(migration, /idx_vpn_subscriptions_user/);
  assert.doesNotMatch(migration, /raw_token|private_key|password|credential|secret/i);
});

test('subscription repair is an allowed confirmed VPN action', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '023_vpn_subscription_repair_action.sql'), 'utf8');
  assert.match(migration, /'subscription\.repair'/);
  for (const action of ['issue', 'revoke', 'rotate', 'export', 'restart', 'probe.install', 'probe.rotate', 'probe.enable', 'probe.disable']) {
    assert.ok(migration.includes(`'${action}'`));
  }
  assert.doesNotMatch(migration, /credential|share_uri|password|secret/i);
});

test('probe credential migration adds only closed VPN action kinds', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '021_vpn_probe_credentials.sql'), 'utf8');
  for (const action of ['probe.install', 'probe.rotate', 'probe.enable', 'probe.disable']) {
    assert.match(migration, new RegExp(`'${action.replace('.', '\\.')}'`));
  }
  assert.doesNotMatch(migration, /credential|share_uri|uri|token|password/i);
});

test('VPN Supervisor migration stores only bounded workflow metadata', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '020_vpn_supervisor_advisory.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE vpn_supervisor_runs/);
  assert.match(migration, /supervisor_acceptance_noop/);
  assert.match(migration, /octet_length\(safe_metadata::text\) <= 4096/);
  assert.match(migration, /synthetic = true AND status IN/);
  assert.doesNotMatch(migration, /raw_log|model_response|prompt_body|credential|private_key|access_token|connection_uri/i);
});

test('Telegram Life OS migration adds only closed guided interaction kinds', () => {
  const migration = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '019_telegram_life_os_interactions.sql'), 'utf8');
  for (const kind of [
    'life_project_create', 'life_project_update', 'life_person_create', 'life_person_update',
    'life_relationship_create', 'life_project_link_create', 'life_family_grant_create',
    'life_family_grant_confirm', 'life_reminder_create', 'life_reminder_reschedule',
    'life_source_create', 'life_source_update', 'life_preference_set',
  ]) {
    assert.match(migration, new RegExp(`'${kind}'`));
  }
  assert.doesNotMatch(migration, /DELETE|TRUNCATE|DROP TABLE/i);
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
