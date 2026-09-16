const assert = require('node:assert/strict');
const test = require('node:test');

const { ProbeCredentialWorkflow, probeBindingFor } = require('../src/vpn/vpnProbeCredentialWorkflow');

const CLIENT_ID = 'vpn-0123456789ab';
const SYNTHETIC_URI = 'vless://123e4567-e89b-42d3-a456-426614174000@203.0.113.10:8443?security=reality#Synthetic';

function harness(options = {}) {
  const deCalls = [];
  const nlCalls = [];
  const de = { async request(request) {
    deCalls.push(request);
    return { result: { state: 'succeeded', data: { shareUri: SYNTHETIC_URI } } };
  } };
  const nl = { async request(request) {
    nlCalls.push(request);
    if (request.operation === 'vpn.external_probe.credential.install') {
      return { result: { state: 'succeeded', data: { targetNode: 'de', protocol: 'vless', installedAt: '2026-09-16T12:00:00Z' } } };
    }
    return { result: { state: 'succeeded', data: { targetNode: 'de', checks: {} } } };
  } };
  return {
    deCalls, nlCalls,
    workflow: new ProbeCredentialWorkflow({ clients: { de, nl }, now: () => new Date('2026-09-16T12:00:00Z'),
      verifiedBindings: options.verifiedBindings || (async () => false) }),
  };
}

test('installation forwards a transient export only to the opposite Host Agent', async () => {
  const { workflow, deCalls, nlCalls } = harness();
  const binding = probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: CLIENT_ID, label: 'Probe NL to DE VLESS' });
  const result = await workflow.install(binding);
  assert.deepEqual(deCalls.map((value) => value.operation), ['vpn.client.export']);
  assert.deepEqual(nlCalls.map((value) => value.operation), ['vpn.external_probe.credential.install', 'vpn.external_probe.run']);
  assert.equal(nlCalls[0].arguments.targetNode, 'de');
  assert.equal(nlCalls[0].arguments.protocol, 'vless');
  assert.equal(result.targetNode, 'de');
  assert.doesNotMatch(JSON.stringify(result), /vless:\/\//i);
  assert.doesNotMatch(JSON.stringify(result), /123e4567/i);
});

test('binding is closed and rejects a normal device credential or a mismatched label', () => {
  assert.throws(() => probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: CLIENT_ID, label: 'My Phone' }), /PROBE_BINDING_INVALID/);
  assert.throws(() => probeBindingFor({ sourceNode: 'de', protocol: 'hysteria2', clientId: CLIENT_ID, label: 'Probe NL to DE VLESS' }), /PROBE_BINDING_INVALID/);
});

test('failed export or installation cannot run a probe and surfaces no secret', async () => {
  const { workflow } = harness();
  workflow.clients.de.request = async () => ({ result: { state: 'unknown', errorCode: 'ACTION_OUTCOME_PENDING' } });
  const binding = probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: CLIENT_ID, label: 'Probe NL to DE VLESS' });
  await assert.rejects(workflow.install(binding), /PROBE_EXPORT_UNKNOWN/);
});
