const assert = require('node:assert/strict');
const test = require('node:test');
const { ExternalProbeMonitor, validateExternalProbe } = require('../src/operations/vpnSupervisor/externalProbeMonitor');

const NOW = new Date('2026-09-16T12:00:00Z');
const checks = Object.fromEntries(['vless_tcp_443', 'vless_tcp_8443', 'hysteria2_udp_443', 'hysteria2_udp_hop'].map((name) => [name, { status: 'healthy', failureCode: null }]));
const result = (targetNode = 'de', sampledAt = NOW.toISOString()) => ({
  version: 1,
  targetNode,
  sampledAt,
  checks: Object.fromEntries(Object.entries(checks).map(([name, value]) => [name, { ...value }])),
});

test('external probe result is target-bound, fresh and secret-free', () => {
  assert.equal(validateExternalProbe(result(), 'de', NOW).checks.vless_tcp_443.status, 'healthy');
  for (const value of [result('nl'), result('de', '2026-09-16T11:50:00Z'), { ...result(), shareUri: 'secret' },
    { ...result(), checks: { ...checks, vless_tcp_443: { status: 'failed', failureCode: null } } }]) {
    assert.equal(validateExternalProbe(value, 'de', NOW).checks.vless_tcp_443.status, 'unknown');
  }
});

test('hop probe is strict and malformed or stale results fail closed', () => {
  const failed = result();
  failed.checks.hysteria2_udp_hop = { status: 'failed', failureCode: 'PROXY_CONNECT_FAILURE' };
  assert.equal(validateExternalProbe(failed, 'de', NOW).checks.hysteria2_udp_hop.status, 'failed');
  const malformed = result();
  delete malformed.checks.hysteria2_udp_hop;
  assert.equal(validateExternalProbe(malformed, 'de', NOW).checks.hysteria2_udp_hop.status, 'unknown');
});

test('DE is observed only from NL runner, NL only from DE runner; errors fail closed', async () => {
  const calls = [];
  const client = (runner) => ({ async request(value) {
    calls.push([runner, value]);
    return { result: { state: 'succeeded', data: result(value.arguments.targetNode) } };
  } });
  const monitor = new ExternalProbeMonitor({ clients: { de: client('de'), nl: client('nl') }, now: () => NOW });
  assert.equal((await monitor.snapshot('de')).checks.hysteria2_udp_443.status, 'healthy');
  assert.equal((await monitor.snapshot('nl')).checks.hysteria2_udp_443.status, 'healthy');
  assert.deepEqual(calls.map(([runner, value]) => [runner, value.arguments.targetNode]), [['nl', 'de'], ['de', 'nl']]);
  assert.ok(calls.every(([, value]) => value.operation === 'vpn.external_probe.snapshot'));
  const broken = new ExternalProbeMonitor({ clients: { nl: { async request() { throw new Error('offline'); } } }, now: () => NOW });
  assert.equal((await broken.snapshot('de')).checks.vless_tcp_443.status, 'unknown');
  assert.equal((await broken.snapshot('nl')).checks.vless_tcp_443.status, 'unknown');
});
