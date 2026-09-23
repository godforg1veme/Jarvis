const assert = require('node:assert/strict');
const test = require('node:test');
const { ProbeCredentialWorkflow, ProbeWorkflowError, probeBindingFor } = require('../src/vpn/vpnProbeCredentialWorkflow');

const NOW = new Date('2026-09-23T15:30:00.000Z');
const PROOF = {
  version: 1,
  targetNode: 'de',
  sampledAt: NOW.toISOString(),
  checks: {
    vless_tcp_443: { status: 'unknown', failureCode: 'NOT_CONFIGURED' },
    vless_tcp_8443: { status: 'healthy', failureCode: null },
    hysteria2_udp_443: { status: 'unknown', failureCode: 'NOT_CONFIGURED' },
    hysteria2_udp_hop: { status: 'unknown', failureCode: 'NOT_CONFIGURED' },
  },
};

function workflow({ state = 'succeeded', data = PROOF } = {}) {
  const calls = [];
  const client = { async request(request) {
    calls.push(request);
    return { result: { state, data } };
  } };
  return { calls, service: new ProbeCredentialWorkflow({ clients: { nl: client, de: client }, now: () => NOW }) };
}

test('recheck runs one read-only probe and returns only the closed target proof', async () => {
  const { service, calls } = workflow();
  const result = await service.recheck({ sourceNode: 'de', runnerNode: 'nl', protocol: 'vless' });
  assert.deepEqual(result, {
    targetNode: 'de', runnerNode: 'nl', protocol: 'vless', acceptedCheck: 'vless_tcp_8443',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'vpn.external_probe.run');
  assert.deepEqual(calls[0].arguments, { targetNode: 'de' });
});

test('recheck refuses a mismatched runner without making a request', async () => {
  const { service, calls } = workflow();
  await assert.rejects(service.recheck({ sourceNode: 'de', runnerNode: 'de', protocol: 'vless' }),
    (error) => error instanceof ProbeWorkflowError && error.code === 'PROBE_BINDING_INVALID');
  assert.equal(calls.length, 0);
});

test('recheck requires a fresh healthy protocol-specific result', async (t) => {
  const cases = [
    ['not configured', { ...PROOF, checks: { ...PROOF.checks, vless_tcp_8443: { status: 'unknown', failureCode: 'NOT_CONFIGURED' } } }, 'PROBE_ACCEPTANCE_UNKNOWN'],
    ['failed check', { ...PROOF, checks: { ...PROOF.checks, vless_tcp_8443: { status: 'failed', failureCode: 'PROXY_CONNECT_FAILURE' } } }, 'PROBE_ACCEPTANCE_FAILED'],
    ['wrong target', { ...PROOF, targetNode: 'nl' }, 'PROBE_ACCEPTANCE_UNKNOWN'],
    ['stale sample', { ...PROOF, sampledAt: '2026-09-23T15:20:00.000Z' }, 'PROBE_ACCEPTANCE_UNKNOWN'],
  ];
  for (const [name, data, code] of cases) {
    await t.test(name, async () => {
      const { service } = workflow({ data });
      await assert.rejects(service.recheck({ sourceNode: 'de', runnerNode: 'nl', protocol: 'vless' }),
        (error) => error instanceof ProbeWorkflowError && error.code === code);
    });
  }
});

test('Hysteria2 recheck accepts only the hopping probe', async () => {
  const data = { ...PROOF, checks: { ...PROOF.checks, hysteria2_udp_hop: { status: 'healthy', failureCode: null } } };
  const { service } = workflow({ data });
  const result = await service.recheck({ sourceNode: 'de', runnerNode: 'nl', protocol: 'hysteria2' });
  assert.equal(result.acceptedCheck, 'hysteria2_udp_hop');
});

test('unknown Host Agent outcome remains unknown and is never reissued', async () => {
  const { service, calls } = workflow({ state: 'unknown' });
  await assert.rejects(service.recheck({ sourceNode: 'de', runnerNode: 'nl', protocol: 'vless' }),
    (error) => error instanceof ProbeWorkflowError && error.code === 'PROBE_RUN_UNKNOWN');
  assert.equal(calls.length, 1);
});

const CLIENT_ID = 'vpn-0123456789ab';
const SYNTHETIC_URI = 'vless://123e4567-e89b-42d3-a456-426614174000@203.0.113.10:8443?security=reality#Synthetic';
const LEGACY_NOW = '2026-09-16T12:00:00Z';

function legacySnapshot(overrides = {}) {
  return {
    version: 1,
    targetNode: 'de',
    sampledAt: LEGACY_NOW,
    checks: {
      vless_tcp_443: { status: 'unknown', failureCode: 'NOT_CONFIGURED' },
      vless_tcp_8443: { status: 'healthy', failureCode: null },
      hysteria2_udp_443: { status: 'unknown', failureCode: 'NOT_CONFIGURED' },
      hysteria2_udp_hop: { status: 'unknown', failureCode: 'NOT_CONFIGURED' },
    },
    ...overrides,
  };
}

function installHarness(options = {}) {
  const deCalls = [];
  const nlCalls = [];
  const de = { async request(request) {
    deCalls.push(request);
    return { result: { state: options.exportState || 'succeeded', data: { shareUri: options.shareUri || SYNTHETIC_URI } } };
  } };
  const nl = { async request(request) {
    nlCalls.push(request);
    if (request.operation === 'vpn.external_probe.credential.install') {
      return { result: { state: options.installState || 'succeeded', data: { targetNode: 'de', protocol: 'vless', installedAt: LEGACY_NOW } } };
    }
    return { result: { state: 'succeeded', data: options.probeData || legacySnapshot() } };
  } };
  return {
    deCalls,
    nlCalls,
    workflow: new ProbeCredentialWorkflow({ clients: { de, nl }, now: () => new Date(LEGACY_NOW) }),
  };
}

test('installation forwards a transient export only to the opposite Host Agent', async () => {
  const { workflow, deCalls, nlCalls } = installHarness();
  const binding = probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: CLIENT_ID, label: 'Probe NL to DE VLESS' });
  const result = await workflow.install(binding);
  assert.deepEqual(deCalls.map((item) => item.operation), ['vpn.client.export']);
  assert.deepEqual(nlCalls.map((item) => item.operation), ['vpn.external_probe.credential.install', 'vpn.external_probe.run']);
  assert.equal(nlCalls[0].arguments.targetNode, 'de');
  assert.equal(nlCalls[0].arguments.protocol, 'vless');
  assert.equal(result.acceptedCheck, 'vless_tcp_8443');
  assert.equal(result.probe, undefined);
  assert.doesNotMatch(JSON.stringify(result), /vless:\/\//i);
});

test('Hysteria installation accepts only the authenticated hopping path', async () => {
  const checks = legacySnapshot().checks;
  checks.vless_tcp_8443 = { status: 'unknown', failureCode: 'NOT_CONFIGURED' };
  checks.hysteria2_udp_hop = { status: 'healthy', failureCode: null };
  const { workflow } = installHarness({ shareUri: 'hy2://synthetic@example.invalid:443/', probeData: legacySnapshot({ checks }) });
  const binding = probeBindingFor({ sourceNode: 'de', protocol: 'hysteria2', clientId: CLIENT_ID, label: 'Probe NL to DE Hysteria' });
  const result = await workflow.install(binding);
  assert.equal(result.acceptedCheck, 'hysteria2_udp_hop');
});

test('failed, unknown, stale, wrong-node and malformed one-shot results cannot accept an install', async () => {
  const binding = probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: CLIENT_ID, label: 'Probe NL to DE VLESS' });
  const variants = [
    [legacySnapshot({ checks: { ...legacySnapshot().checks, vless_tcp_8443: { status: 'failed', failureCode: 'PROXY_CONNECT_FAILURE' } } }), /PROBE_ACCEPTANCE_FAILED/],
    [legacySnapshot({ checks: { ...legacySnapshot().checks, vless_tcp_8443: { status: 'unknown', failureCode: 'CHECK_UNAVAILABLE' } } }), /PROBE_ACCEPTANCE_UNKNOWN/],
    [legacySnapshot({ sampledAt: '2026-09-16T11:50:00Z' }), /PROBE_ACCEPTANCE_UNKNOWN/],
    [legacySnapshot({ targetNode: 'nl' }), /PROBE_ACCEPTANCE_UNKNOWN/],
    [legacySnapshot({ checks: {} }), /PROBE_ACCEPTANCE_UNKNOWN/],
  ];
  for (const [probeData, error] of variants) {
    const { workflow } = installHarness({ probeData });
    await assert.rejects(workflow.install(binding), error);
  }
});

test('binding is closed and rejects a mismatched protocol label', () => {
  assert.throws(() => probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: 'vpn-invalid', label: 'Probe NL to DE VLESS' }), /PROBE_BINDING_INVALID/);
  assert.throws(() => probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: CLIENT_ID, label: 'My Phone' }), /PROBE_BINDING_INVALID/);
  assert.throws(() => probeBindingFor({ sourceNode: 'de', protocol: 'hysteria2', clientId: CLIENT_ID, label: 'Probe NL to DE VLESS' }), /PROBE_BINDING_INVALID/);
});

test('failed export or installation cannot run a probe and exposes no secret', async () => {
  const binding = probeBindingFor({ sourceNode: 'de', protocol: 'vless', clientId: CLIENT_ID, label: 'Probe NL to DE VLESS' });
  for (const options of [
    { exportState: 'unknown', error: /PROBE_EXPORT_UNKNOWN/ },
    { installState: 'unknown', error: /PROBE_INSTALL_UNKNOWN/ },
    { installState: 'failed', error: /PROBE_INSTALL_FAILED/ },
  ]) {
    const { workflow, deCalls, nlCalls } = installHarness(options);
    await assert.rejects(workflow.install(binding), options.error);
    assert.deepEqual(deCalls.map((item) => item.operation), ['vpn.client.export']);
    assert.equal(nlCalls.some((item) => item.operation === 'vpn.external_probe.run'), false);
  }
});

function monitorHarness(responses = {}) {
  const calls = [];
  const clients = Object.fromEntries(['de', 'nl'].map((node) => [node, {
    async request(request) {
      calls.push({ node, operation: request.operation, targetNode: request.arguments.targetNode });
      return responses[node]?.shift() || { result: { state: 'succeeded', data: {} } };
    },
  }]));
  return { calls, workflow: new ProbeCredentialWorkflow({ clients, verifiedBindings: async () => true }) };
}

test('monitor activation confirms both runners in order', async () => {
  const { workflow, calls } = monitorHarness();
  assert.deepEqual(await workflow.enable(), { monitoring: true });
  assert.deepEqual(calls.map(({ node, operation, targetNode }) => [node, operation, targetNode]), [
    ['nl', 'vpn.external_probe.monitor.enable', 'de'],
    ['de', 'vpn.external_probe.monitor.enable', 'nl'],
  ]);
});

test('first monitor failure or unknown outcome never dispatches the second enable', async () => {
  for (const state of ['failed', 'unknown']) {
    const { workflow, calls } = monitorHarness({ nl: [{ result: { state } }] });
    await assert.rejects(workflow.enable(), new RegExp(state === 'unknown' ? 'PROBE_MONITOR_UNKNOWN' : 'PROBE_MONITOR_FAILED'));
    assert.deepEqual(calls.map(({ node, operation }) => [node, operation]), [['nl', 'vpn.external_probe.monitor.enable']]);
  }
});

test('second monitor failure compensates the first exactly once', async () => {
  const { workflow, calls } = monitorHarness({ de: [{ result: { state: 'failed' } }] });
  await assert.rejects(workflow.enable(), /PROBE_MONITOR_FAILED/);
  assert.deepEqual(calls.map(({ node, operation }) => [node, operation]), [
    ['nl', 'vpn.external_probe.monitor.enable'],
    ['de', 'vpn.external_probe.monitor.enable'],
    ['nl', 'vpn.external_probe.monitor.disable'],
  ]);
});

test('unknown second outcome or unconfirmed compensation stays unknown', async () => {
  for (const [second, compensation] of [['unknown', 'succeeded'], ['failed', 'unknown']]) {
    const { workflow, calls } = monitorHarness({
      de: [{ result: { state: second } }],
      nl: [{ result: { state: 'succeeded' } }, { result: { state: compensation } }],
    });
    await assert.rejects(workflow.enable(), /PROBE_MONITOR_UNKNOWN/);
    assert.equal(calls.filter(({ operation }) => operation === 'vpn.external_probe.monitor.disable').length, 1);
  }
});

test('second-runner transport loss compensates the first and never retries activation', async () => {
  const calls = [];
  const workflow = new ProbeCredentialWorkflow({
    verifiedBindings: async () => true,
    clients: {
      nl: { async request(request) { calls.push(['nl', request.operation]); return { result: { state: 'succeeded', data: {} } }; } },
      de: { async request(request) { calls.push(['de', request.operation]); throw new Error('synthetic transport loss'); } },
    },
  });
  await assert.rejects(workflow.enable(), /PROBE_MONITOR_UNKNOWN/);
  assert.deepEqual(calls, [
    ['nl', 'vpn.external_probe.monitor.enable'],
    ['de', 'vpn.external_probe.monitor.enable'],
    ['nl', 'vpn.external_probe.monitor.disable'],
  ]);
});
