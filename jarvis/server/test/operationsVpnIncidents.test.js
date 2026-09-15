const assert = require('node:assert/strict');
const test = require('node:test');
const { IncidentEngine } = require('../src/operations/incidents/incidentEngine');
const { VpnIncidentAdapter } = require('../src/operations/incidents/vpnIncidentAdapter');

function healthWith(primary = null) {
  const value = {
    host: 'healthy',
    network: { dns: 'healthy', outbound: 'healthy' },
    xray: { service: 'healthy', config: 'healthy', listener: 'healthy', protocolProbe: 'unknown' },
    hysteria2: { service: 'healthy', config: 'healthy', listener: 'healthy', auth: 'healthy', authEndpoint: 'healthy', authCredentialProbe: 'healthy', protocolProbe: 'unknown' },
    diagnosis: { version: 1, state: primary ? 'incident' : 'healthy', primary, secondarySignals: [
      { code: 'XRAY_PROTOCOL_UNVERIFIED', severity: 'info' },
      { code: 'HYSTERIA2_PROTOCOL_UNVERIFIED', severity: 'info' },
    ] },
  };
  return value;
}

function authFailure() {
  const value = healthWith({
    code: 'HYSTERIA2_AUTH_ENDPOINT_FAILURE', failureKind: 'vpn.hysteria2.auth_endpoint_failure', severity: 'error',
    scope: 'hysteria2', confidence: 'high', likelyCause: 'host_agent_auth_dependency',
    evidence: [{ path: 'hysteria2.service', status: 'healthy' }, { path: 'hysteria2.authEndpoint', status: 'unavailable' }],
    safeNextChecks: ['host_agent_status', 'hysteria_auth_endpoint_probe'],
  });
  value.hysteria2.auth = 'unavailable';
  value.hysteria2.authEndpoint = 'unavailable';
  value.hysteria2.authCredentialProbe = 'unavailable';
  return value;
}

function xrayFailure() {
  const value = healthWith({
    code: 'XRAY_SERVICE_FAILURE', failureKind: 'vpn.xray.service_failure', severity: 'error',
    scope: 'xray', confidence: 'high', likelyCause: 'xray_service',
    evidence: [{ path: 'xray.config', status: 'healthy' }, { path: 'xray.service', status: 'unavailable' }, { path: 'xray.listener', status: 'unavailable' }],
    safeNextChecks: ['xray_service_status'],
  });
  value.xray.service = 'unavailable';
  value.xray.listener = 'unavailable';
  return value;
}

function harness() {
  const incidents = new Map();
  const notifications = [];
  let sequence = 0;
  const repository = {
    async serviceByKey(hostId, key) { assert.equal(hostId, 'host-1'); return { id: `${key}-service` }; },
    async openOrUpdateIncident(input) {
      let incident = incidents.get(input.failureKind);
      const opened = !incident || incident.state !== 'open';
      incident = { id: incident?.id || `incident-${++sequence}`, ...input, state: 'open', opened, notified: incident?.notified || false };
      incidents.set(input.failureKind, incident);
      return incident;
    },
    async resolveClassifiedVpnIncidents({ hostId, exceptFailureKind }) {
      assert.equal(hostId, 'host-1');
      for (const [kind, incident] of incidents) if (incident.state === 'open' && kind !== exceptFailureKind) incident.state = 'resolved';
    },
    async claimIncidentNotification(id) {
      const incident = [...incidents.values()].find((item) => item.id === id);
      return Boolean(incident && !incident.notified);
    },
    async markIncidentNotified(id) {
      const incident = [...incidents.values()].find((item) => item.id === id);
      incident.notified = true;
    },
  };
  const notifier = { async notify(incident, service) { notifications.push({ incident, service }); return true; } };
  const engine = new IncidentEngine({ repository, hostId: 'host-1', notifier });
  return { repository, incidents, notifications, adapter: new VpnIncidentAdapter({ repository, incidentEngine: engine, hostId: 'host-1' }) };
}

test('simulated auth outage opens one causal incident after debounce and never executes a repair', async () => {
  const { adapter, incidents, notifications } = harness();
  await adapter.observe(authFailure());
  await adapter.observe(authFailure());
  assert.equal(incidents.size, 0);
  await adapter.observe(authFailure());
  await adapter.observe(authFailure());
  assert.equal(incidents.get('vpn.hysteria2.auth_endpoint_failure').state, 'open');
  assert.equal(incidents.get('vpn.hysteria2.auth_endpoint_failure').severity, 'error');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].service.serviceKey, 'hysteria2');
  assert.doesNotMatch(incidents.get('vpn.hysteria2.auth_endpoint_failure').technicalDetail, /password|privateKey|vless:\/\/|hy2:\/\//i);
});

test('changed root cause replaces the old VPN incident and healthy recovery resolves it', async () => {
  const { adapter, incidents } = harness();
  for (let count = 0; count < 3; count++) await adapter.observe(authFailure());
  for (let count = 0; count < 2; count++) await adapter.observe(xrayFailure());
  assert.equal(incidents.get('vpn.hysteria2.auth_endpoint_failure').state, 'open');
  await adapter.observe(xrayFailure());
  assert.equal(incidents.get('vpn.hysteria2.auth_endpoint_failure').state, 'resolved');
  assert.equal(incidents.get('vpn.xray.service_failure').state, 'open');
  await adapter.observe(healthWith());
  assert.equal(incidents.get('vpn.xray.service_failure').state, 'resolved');
});

test('healthy local checks with unknown protocol probes never open an incident', async () => {
  const { adapter, incidents, notifications } = harness();
  for (let count = 0; count < 5; count++) await adapter.observe(healthWith());
  assert.equal(incidents.size, 0);
  assert.equal(notifications.length, 0);
});

test('invalid Host Agent diagnosis is rejected before incident persistence', async () => {
  const { adapter, incidents } = harness();
  const value = authFailure();
  value.diagnosis.primary.evidence.push({ path: 'logs.password', status: 'unavailable' });
  await assert.rejects(adapter.observe(value));
  assert.equal(incidents.size, 0);
});

test('three unavailable health snapshots open one bounded Host Agent diagnostic incident', async () => {
  const { adapter, incidents, notifications } = harness();
  await adapter.observeUnavailable();
  await adapter.observeUnavailable();
  assert.equal(incidents.size, 0);
  await adapter.observeUnavailable();
  const incident = incidents.get('vpn.health_unavailable');
  assert.equal(incident.state, 'open');
  assert.equal(incident.technicalDetail, '{"version":1,"state":"unavailable","source":"vpn.health.snapshot"}');
  assert.equal(notifications.length, 1);
});
