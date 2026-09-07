const assert = require('node:assert/strict');
const test = require('node:test');
const { CollectorWorker } = require('../src/operations/collectors/collectorWorker');

test('backup collector persists a validated result and rejects malformed available snapshots', async () => {
  const saved = [];
  let data = { available: true, result: { runId: '20260905T010000Z', status: 'failed', startedAt: '2026-09-05T01:00:00Z', completedAt: '2026-09-05T01:01:00Z' } };
  const worker = new CollectorWorker({ hostId: 'host-1', repository: { async recordBackupResult(value) { saved.push(value); } }, client: {
    async request(request) { assert.equal(request.operation, 'backup.status'); return { result: { state: 'succeeded', data } }; },
  } });
  await worker.collectBackup();
  assert.equal(saved[0].status, 'failed');
  data = { available: true };
  await assert.rejects(worker.collectBackup(), /Missing backup result/);
  data = { available: false };
  await worker.collectBackup();
  assert.equal(saved.length, 1);
});

test('operations collector validates and persists all declared service snapshots', async () => {
  const operations = [];
  const services = [];
  const client = { async request(request) {
    operations.push(request.operation);
    if (request.operation === 'host.snapshot') return { result: { state: 'succeeded', data: { loadavg: ['0.10', '0.20', '0.30'], meminfo: ['MemTotal: 1000 kB', 'MemFree: 200 kB', 'MemAvailable: 400 kB'], uptimeSeconds: 100, diskUsedPercent: 25, inodeUsedPercent: 2 } } };
    if (request.operation === 'parser.snapshot') return { result: { state: 'succeeded', data: { id: 'telegram-parser', sourceType: 'systemd', sourceState: 'active', healthState: 'healthy', detail: 'running' } } };
    return { result: { state: 'succeeded', data: { services: [
      { id: 'jarvis-server', sourceType: 'docker', sourceState: 'active', healthState: 'healthy', detail: 'healthy' },
      { id: 'postgres', sourceType: 'docker', sourceState: 'active', healthState: 'healthy', detail: 'healthy' },
      { id: 'cloudflared', sourceType: 'docker', sourceState: 'active', healthState: 'healthy', detail: 'running' },
      { id: 'telegram-parser', sourceType: 'systemd', sourceState: 'active', healthState: 'healthy', detail: 'running' },
    ] } } };
  } };
  const repository = {
    async recordHostSnapshot(value) { assert.equal(value.state, 'healthy'); },
    async recordMetricSamples(value) { assert.equal(value.metrics.memory_used_percent, 60); },
    async upsertService(value) { services.push(value); },
    async recordParserResult(value) { assert.equal(value.kind, 'service_state'); },
    async recordEvent(value) { return { id: services.length, event_type: value.type }; },
  };
  const worker = new CollectorWorker({ client, repository, hostId: 'host-1', intervalMs: 30000 });
  await worker.runOnce();
  assert.deepEqual(operations, ['host.snapshot', 'services.snapshot', 'parser.snapshot']);
  assert.deepEqual(services.map((service) => service.serviceKey).sort(), ['cloudflared', 'jarvis-server', 'postgres', 'telegram-parser']);
  assert.ok(services.every((service) => service.healthState === 'healthy'));
});

test('operations collector renders every declared service unavailable after an invalid snapshot', async () => {
  const services = [];
  const client = { async request(request) {
    if (request.operation === 'host.snapshot') return { result: { state: 'succeeded', data: { loadavg: ['0', '0', '0'], meminfo: [], uptimeSeconds: 100 } } };
    return { result: { state: 'succeeded', data: { services: [{ id: 'unknown-service' }] } } };
  } };
  const repository = {
    async recordHostSnapshot() {},
    async recordMetricSamples() {},
    async upsertService(value) { services.push(value); },
  };
  const worker = new CollectorWorker({ client, repository, hostId: 'host-1', intervalMs: 30000 });
  await worker.runOnce();
  assert.equal(services.length, 4);
  assert.ok(services.every((service) => service.healthState === 'unavailable'));
});
