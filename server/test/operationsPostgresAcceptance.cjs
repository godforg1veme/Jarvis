// Explicit opt-in integration checks. Creates and drops only a uniquely named
// fixture schema. Run inside the server container with its existing environment.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { DocumentRepository } = require('../src/knowledge/documentRepository');
const { OperationsRepository } = require('../src/operations/repositories/operationsRepository');
const { loadConfig } = require('../src/config/loadConfig');
const { IncidentNotifier } = require('../src/operations/incidents/incidentNotifier');
const { Bot } = require('grammy');
const { HostAgentClient } = require('../src/operations/hostAgentClient');

(async () => {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const unauthorized = await new Promise((resolve, reject) => {
    require('node:http').get('http://127.0.0.1:3210/ops/api/overview', { headers: { host: new URL(config.operationsPublicOrigin).host } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(unauthorized, 401);
  const agent = new HostAgentClient({ socketPath: config.operationsSocketPath, authenticatorPath: config.operationsAuthenticatorPath });
  const inventory = await agent.request({ version: 1, requestId: crypto.randomUUID(), operation: 'inventory.snapshot', arguments: {}, sentAt: new Date().toISOString() });
  assert.equal(inventory.result.state, 'succeeded');
  assert.deepEqual(inventory.result.data.unavailable, []);
  console.log(`PASS Host Agent: ${inventory.result.data.items.length} discovered components, no control granted by discovery`);
  const fixture = `ops_acceptance_${crypto.randomBytes(8).toString('hex')}`;
  const gate = await pool.connect(); const worker = await pool.connect();
  try {
    await gate.query(`CREATE SCHEMA ${fixture}`);
    for (const client of [gate, worker]) await client.query(`SET search_path TO ${fixture}`);
    await gate.query('CREATE TABLE ops_maintenance_flags (flag text PRIMARY KEY,enabled boolean NOT NULL)');
    await gate.query("INSERT INTO ops_maintenance_flags VALUES ('knowledge_writes_paused',false)");
    await gate.query(`CREATE TABLE jobs (id int PRIMARY KEY, user_id int,kind text,payload jsonb,status text,
      available_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),attempts int DEFAULT 0,
      max_attempts int DEFAULT 3,locked_at timestamptz,locked_by text,updated_at timestamptz)`);
    await gate.query("INSERT INTO jobs (id,user_id,kind,payload,status) VALUES (1,1,'document_ingest','{}','queued')");
    await gate.query('BEGIN');
    await gate.query("UPDATE ops_maintenance_flags SET enabled=true WHERE flag='knowledge_writes_paused'");
    let settled = false;
    const claiming = new DocumentRepository(worker).claimNextIngest('acceptance').then((value) => { settled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(settled, false, 'worker must wait for the in-progress maintenance change');
    await gate.query('COMMIT');
    assert.equal(await claiming, null, 'worker must observe the committed pause');
    await gate.query('UPDATE ops_maintenance_flags SET enabled=false');
    assert.equal((await new DocumentRepository(worker).claimNextIngest('acceptance')).id, 1);
    console.log('PASS PostgreSQL: concurrent maintenance gate blocks and resumes ingest');

    await gate.query('SET search_path TO public');
    await gate.query('BEGIN');
    const host = (await gate.query('SELECT id FROM ops_hosts ORDER BY created_at LIMIT 1')).rows[0];
    const repository = new OperationsRepository(gate);
    await repository.healthChecks(host.id);
    await repository.events(host.id, 10);
    await new OperationsRepository({ query(sql) { return gate.query(`EXPLAIN ${sql}`); } }).applyRetention();
    const service = (await gate.query('SELECT id FROM ops_services WHERE host_id=$1 LIMIT 1', [host.id])).rows[0];
    const logs = [{ observedAt: '2000-01-01T00:00:00Z', priority: 3, message: 'test operational summary', byteSize: 24, fingerprint: 'ab'.repeat(32) }];
    await repository.recordLogEntries({ hostId: host.id, serviceId: service.id, source: 'docker', entries: logs });
    await repository.recordLogEntries({ hostId: host.id, serviceId: service.id, source: 'docker', entries: logs });
    const logCount = await gate.query("SELECT count(*)::int AS count FROM ops_log_entries WHERE observed_at='2000-01-01T00:00:00Z' AND service_id=$1", [service.id]);
    assert.equal(logCount.rows[0].count, 1);
    await repository.recordBackupResult({ hostId: host.id, runId: '20000101T000000Z', status: 'succeeded', startedAt: '2000-01-01T00:00:00Z', completedAt: '2000-01-01T00:01:00Z' });
    await repository.recordBackupResult({ hostId: host.id, runId: '20000101T000000Z', status: 'failed', startedAt: '2000-01-01T00:00:00Z', completedAt: '2000-01-01T00:02:00Z' });
    const rows = await gate.query("SELECT status FROM ops_backup_runs WHERE host_id=$1 AND started_at='2000-01-01T00:00:00Z'", [host.id]);
    assert.deepEqual(rows.rows, [{ status: 'failed' }]);
    const incident = await repository.openOrUpdateIncident({ hostId: host.id, serviceId: null, failureKind: `acceptance_${crypto.randomBytes(4).toString('hex')}`, severity: 'warning', summary: 'Тест доставки уведомлений — реальные сервисы работают', technicalDetail: 'synthetic acceptance, rolled back' });
    assert.equal(await repository.claimIncidentNotification(incident.id), true);
    assert.equal(await repository.claimIncidentNotification(incident.id), false);
    if (process.env.JARVIS_ACCEPTANCE_NOTIFY === '1') {
      const bot = new Bot(config.telegramBotToken);
      const notifier = new IncidentNotifier({ getBot: () => bot, ownerTelegramId: config.operationsOwnerTelegramId, panelOrigin: config.operationsPublicOrigin });
      assert.equal(await notifier.notify(incident, { serviceKey: 'acceptance' }), true);
      console.log('PASS Telegram: synthetic notification accepted by Bot API');
    }
    await repository.markIncidentNotified(incident.id);
    assert.equal(await repository.claimIncidentNotification(incident.id), false);
    await gate.query('ROLLBACK');
    console.log('PASS PostgreSQL: backup deduplication and notification retry lease; fixtures rolled back');
  } finally {
    await gate.query('ROLLBACK');
    await gate.query('SET search_path TO public');
    await worker.query('SET search_path TO public');
    await gate.query(`DROP SCHEMA IF EXISTS ${fixture} CASCADE`);
    gate.release(); worker.release(); await pool.end();
  }
})().catch((error) => { console.error('PostgreSQL acceptance failed', { name: error.name, code: error.code, actual: typeof error.actual === 'number' ? error.actual : undefined, expected: typeof error.expected === 'number' ? error.expected : undefined }); process.exitCode = 1; });
