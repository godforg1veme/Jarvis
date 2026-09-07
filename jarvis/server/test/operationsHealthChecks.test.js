const assert = require('node:assert/strict');
const test = require('node:test');
const { HealthCheckWorker } = require('../src/operations/collectors/healthCheckWorker');

test('provider probe uses a durable six-hour claim and only a synthetic message', async () => {
  let claimed = false; let requests = 0; const records = [];
  const pool = { async query(sql, args) {
    if (sql.includes('RETURNING check_key')) { const rowCount = claimed ? 0 : 1; claimed = true; assert.match(sql, /interval '6 hours'/); return { rowCount }; }
    if (sql.startsWith('SELECT state')) return { rows: [{ state: 'healthy', summary: '' }] };
    records.push(args); return { rows: [] };
  } };
  const options = { pool, hostId: 'host', incidentEngine: { async observe() {} }, provider: { async answer(input) {
    requests++; assert.deepEqual(Object.keys(input), ['messages']);
    assert.deepEqual(input.messages, [{ role: 'user', content: 'Health check. Reply only OK.' }]); return 'OK';
  } } };
  await new HealthCheckWorker(options).probeProvider();
  await new HealthCheckWorker(options).probeProvider();
  assert.equal(requests, 1);
  assert.equal(records[0][2], 'healthy');
});

test('provider failures are persisted without error text or response contents', async () => {
  const saved = []; const incidents = [];
  const worker = new HealthCheckWorker({ hostId: 'host', pool: { async query(sql, args) { if (sql.includes('RETURNING check_key')) return { rowCount: 1 }; saved.push(args); return { rows: [] }; } },
    incidentEngine: { async observe(value) { incidents.push(value); } }, provider: { async answer() { throw new Error('private-api-key'); } } });
  await worker.probeProvider();
  assert.equal(saved[0][2], 'unavailable');
  assert.equal(incidents[0].failureKind, 'check_provider');
  assert.equal(JSON.stringify({ saved, incidents }).includes('private-api-key'), false);
});
