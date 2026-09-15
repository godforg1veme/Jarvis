const assert = require('node:assert/strict');
const test = require('node:test');
const { parseVpnHealth } = require('../src/vpn/vpnHealthSchema');

function healthy() {
  return {
    host: 'healthy',
    network: { dns: 'healthy', outbound: 'healthy' },
    xray: { service: 'healthy', config: 'healthy', listener: 'healthy', protocolProbe: 'unknown' },
    hysteria2: { service: 'healthy', config: 'healthy', listener: 'healthy', auth: 'healthy', authEndpoint: 'healthy', authCredentialProbe: 'healthy', protocolProbe: 'unknown' },
    diagnosis: { version: 1, state: 'healthy', primary: null, secondarySignals: [
      { code: 'XRAY_PROTOCOL_UNVERIFIED', severity: 'info' },
      { code: 'HYSTERIA2_PROTOCOL_UNVERIFIED', severity: 'info' },
    ] },
  };
}

function authFailure() {
  const value = healthy();
  value.hysteria2.auth = 'unavailable';
  value.hysteria2.authEndpoint = 'unavailable';
  value.hysteria2.authCredentialProbe = 'unavailable';
  value.diagnosis = { version: 1, state: 'incident', primary: {
    code: 'HYSTERIA2_AUTH_ENDPOINT_FAILURE', failureKind: 'vpn.hysteria2.auth_endpoint_failure',
    severity: 'error', scope: 'hysteria2', confidence: 'high', likelyCause: 'host_agent_auth_dependency',
    evidence: [
      { path: 'hysteria2.service', status: 'healthy' },
      { path: 'hysteria2.authEndpoint', status: 'unavailable' },
    ],
    safeNextChecks: ['host_agent_status', 'hysteria_auth_endpoint_probe'],
  }, secondarySignals: healthy().diagnosis.secondarySignals };
  return value;
}

test('accepts a strict healthy VPN diagnosis', () => {
  assert.deepEqual(parseVpnHealth(healthy()), healthy());
});

test('accepts a causal Hysteria auth dependency diagnosis', () => {
  assert.equal(parseVpnHealth(authFailure()).diagnosis.primary.code, 'HYSTERIA2_AUTH_ENDPOINT_FAILURE');
});

test('rejects free-form and excessive evidence', () => {
  const value = authFailure();
  value.diagnosis.primary.evidence = Array.from({ length: 13 }, (_, index) => ({ path: 'host', status: index ? 'healthy' : 'unavailable' }));
  assert.throws(() => parseVpnHealth(value));
  value.diagnosis.primary.evidence = [{ path: 'logs.password', status: 'unavailable' }];
  assert.throws(() => parseVpnHealth(value));
});

test('rejects mismatched code metadata and snapshot evidence', () => {
  const wrongKind = authFailure();
  wrongKind.diagnosis.primary.failureKind = 'vpn.xray.service_failure';
  assert.throws(() => parseVpnHealth(wrongKind));

  const wrongEvidence = authFailure();
  wrongEvidence.diagnosis.primary.evidence[0].status = 'unavailable';
  assert.throws(() => parseVpnHealth(wrongEvidence));

  const falseIncident = healthy();
  falseIncident.diagnosis.state = 'incident';
  falseIncident.diagnosis.primary = authFailure().diagnosis.primary;
  falseIncident.diagnosis.primary.evidence = [{ path: 'hysteria2.service', status: 'healthy' }];
  assert.throws(() => parseVpnHealth(falseIncident));
});

test('rejects a healthy diagnosis when a required local check failed', () => {
  const value = healthy();
  value.xray.listener = 'unavailable';
  assert.throws(() => parseVpnHealth(value));

  value.diagnosis.state = 'uncertain';
  assert.throws(() => parseVpnHealth(value));
});

test('rejects injected secret-bearing fields at every strict boundary', () => {
  for (const mutate of [
    (value) => { value.password = 'secret'; },
    (value) => { value.diagnosis.prompt = 'vless://secret'; },
    (value) => { value.diagnosis.primary = { shell: 'rm -rf /' }; value.diagnosis.state = 'incident'; },
    (value) => { value.xray.error = '/etc/xray/config.json'; },
  ]) {
    const value = healthy();
    mutate(value);
    assert.throws(() => parseVpnHealth(value));
  }
});

test('requires protocol secondary signals to match raw probe uncertainty', () => {
  const value = healthy();
  value.diagnosis.secondarySignals = [];
  assert.throws(() => parseVpnHealth(value));
});
