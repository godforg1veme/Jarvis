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
  const vpnHealth = [];
  const client = { async request(request) {
    operations.push(request.operation);
    if (request.operation === 'host.snapshot') return { result: { state: 'succeeded', data: { loadavg: ['0.10', '0.20', '0.30'], meminfo: ['MemTotal: 1000 kB', 'MemFree: 200 kB', 'MemAvailable: 400 kB'], uptimeSeconds: 100, diskUsedPercent: 25, inodeUsedPercent: 2 } } };
    if (request.operation === 'vpn.status' || request.operation === 'vpn.hysteria2.status') return { result: { state: 'succeeded', data: { serviceState: 'active', configValid: true, listenerReady: true, clientCount: 1 } } };
    if (request.operation === 'vpn.health.snapshot') return { result: { state: 'succeeded', data: {
      host: 'healthy', network: { dns: 'healthy', outbound: 'healthy' },
      xray: { service: 'healthy', config: 'healthy', listener: 'healthy', protocolProbe: 'unknown' },
      hysteria2: { service: 'healthy', config: 'healthy', listener: 'healthy', auth: 'healthy', authEndpoint: 'healthy', authCredentialProbe: 'healthy', protocolProbe: 'unknown' },
      diagnosis: { version: 1, state: 'healthy', primary: null, secondarySignals: [
        { code: 'XRAY_PROTOCOL_UNVERIFIED', severity: 'info' }, { code: 'HYSTERIA2_PROTOCOL_UNVERIFIED', severity: 'info' },
      ] },
    } } };
    if (request.operation === 'parser.snapshot') return { result: { state: 'succeeded', data: { id: 'telegram-parser', sourceType: 'systemd', sourceState: 'active', healthState: 'healthy', detail: 'running' } } };
    return { result: { state: 'succeeded', data: { services: [
      { id: 'jarvis-server', sourceType: 'docker', sourceState: 'active', healthState: 'healthy', detail: 'healthy' },
      { id: 'postgres', sourceType: 'docker', sourceState: 'active', healthState: 'healthy', detail: 'healthy' },
      { id: 'cloudflared', sourceType: 'docker', sourceState: 'active', healthState: 'healthy', detail: 'running' },
      { id: 'xray', sourceType: 'systemd', sourceState: 'active', healthState: 'healthy', detail: 'running' },
      { id: 'hysteria2', sourceType: 'systemd', sourceState: 'active', healthState: 'healthy', detail: 'running' },
      { id: 'telegram-parser', sourceType: 'systemd', sourceState: 'active', healthState: 'healthy', detail: 'running' },
    ] } } };
  } };
  const repository = {
    async recordHostSnapshot(value) { assert.equal(value.state, 'healthy'); },
    async recordMetricSamples(value) {
      if (value.serviceId) assert.equal(value.metrics.vpn_listener_ready, 1);
      else assert.equal(value.metrics.memory_used_percent, 60);
    },
    async upsertService(value) { services.push(value); return { id: value.serviceKey, ...value }; },
    async serviceByKey() { return { id: 'xray' }; },
    async recordParserResult(value) { assert.equal(value.kind, 'service_state'); },
    async recordEvent(value) { return { id: services.length, event_type: value.type }; },
  };
  const worker = new CollectorWorker({ client, repository, hostId: 'host-1', intervalMs: 30000,
    vpnIncidentAdapter: { async observe(value) { vpnHealth.push(value); } } });
  await worker.runOnce();
  assert.deepEqual(operations, ['host.snapshot', 'services.snapshot', 'vpn.status', 'vpn.hysteria2.status', 'vpn.health.snapshot', 'parser.snapshot']);
  assert.equal(vpnHealth[0].diagnosis.state, 'healthy');
  assert.deepEqual([...new Set(services.map((service) => service.serviceKey))].sort(), ['cloudflared', 'hysteria2', 'jarvis-server', 'postgres', 'telegram-parser', 'xray']);
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
  assert.equal(services.length, 6);
  assert.ok(services.every((service) => service.healthState === 'unavailable'));
});

test('VPN collector reports an unavailable classified snapshot without opening generic VPN incidents', async () => {
  let unavailable = 0;
  let genericIncidents = 0;
  const worker = new CollectorWorker({ hostId: 'host-1', repository: {
    async serviceByKey() { return { id: 'vpn-service' }; },
    async upsertService(value) { return { id: `${value.serviceKey}-service`, ...value }; },
    async recordMetricSamples() {},
  }, client: { async request(request) {
    if (request.operation === 'vpn.health.snapshot') return { result: { state: 'failed', errorCode: 'UNAVAILABLE' } };
    return { result: { state: 'succeeded', data: { serviceState: 'active', configValid: true, listenerReady: true, clientCount: 0 } } };
  } }, incidentEngine: { async observe() { genericIncidents += 1; } }, vpnIncidentAdapter: {
    async observe() { assert.fail('invalid snapshot must not be observed as healthy'); },
    async observeUnavailable() { unavailable += 1; },
  } });
  await assert.rejects(worker.collectVpn(), /snapshot unavailable/);
  assert.equal(unavailable, 1);
  assert.equal(genericIncidents, 0);
});

test('VPN-only collector monitors a secondary node without probing control-plane services', async () => {
  const operations = [];
  const hostStates = [];
  const observed = [];
  const worker = new CollectorWorker({
    hostId: 'host-nl', intervalMs: 30000, vpnOnly: true,
    repository: {
      async recordHostSnapshot(value) { hostStates.push(value); },
      async recordMetricSamples() {},
      async serviceByKey() { return { id: 'vpn-service' }; },
      async upsertService(value) { return { id: `${value.serviceKey}-service`, ...value }; },
    },
    client: { async request(request) {
      operations.push(request.operation);
      if (request.operation === 'host.snapshot') return { result: { state: 'succeeded', data: { loadavg: ['0', '0', '0'], meminfo: [], uptimeSeconds: 100 } } };
      if (request.operation === 'vpn.health.snapshot') return { result: { state: 'succeeded', data: { diagnosis: { state: 'healthy' } } } };
      return { result: { state: 'succeeded', data: { serviceState: 'active', configValid: true, listenerReady: true, clientCount: 0 } } };
    } },
    vpnIncidentAdapter: { async observe(value) { observed.push(value); }, async observeUnavailable() {} },
  });
  await worker.runOnce();
  assert.deepEqual(operations, ['host.snapshot', 'vpn.status', 'vpn.hysteria2.status', 'vpn.health.snapshot']);
  assert.deepEqual(hostStates, [{ hostId: 'host-nl', state: 'healthy' }]);
  assert.equal(observed.length, 1);
});
