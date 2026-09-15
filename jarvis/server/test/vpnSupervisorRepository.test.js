const assert = require('node:assert/strict');
const test = require('node:test');
const { VpnSupervisorRepository } = require('../src/operations/vpnSupervisor/repository');

test('VPN Supervisor repository parameterizes bounded planning metadata', async () => {
  const calls = [];
  const repository = new VpnSupervisorRepository({ async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: params[0] }] }; } });
  await repository.createPlanning({
    id: '11111111-1111-4111-8111-111111111111',
    hostId: '22222222-2222-4222-8222-222222222222',
    synthetic: true,
    incidentCode: 'SUPERVISOR_ACCEPTANCE_TEST',
    incidentRevision: 'a'.repeat(64),
    promptVersion: 'vpn-supervisor-v1',
    catalogVersion: 'vpn-playbooks-v1',
    evidenceDigest: 'b'.repeat(64),
    safeMetadata: { kind: 'acceptance', evidenceCount: 2 },
    expiresAt: new Date('2026-09-16T12:10:00Z'),
  });
  assert.match(calls[0].sql, /VALUES \(\$1,\$2,\$3,'planning',\$4/);
  assert.equal(calls[0].params.length, 10);
  assert.doesNotMatch(JSON.stringify(calls[0].params), /raw log|model response|vless:\/\/|Bearer/i);
});

test('VPN Supervisor owner decision is atomic, expiring, and single-state', async () => {
  const calls = [];
  const repository = new VpnSupervisorRepository({ async query(sql, params) {
    calls.push({ sql: String(sql), params });
    return { rows: [], rowCount: 0 };
  } });
  assert.equal(await repository.decide({ id: '11111111-1111-4111-8111-111111111111', approved: true }), null);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /status='awaiting_owner' AND expires_at>now\(\)/);
  assert.match(calls[1].sql, /status='expired'/);
  assert.deepEqual(calls[0].params, ['11111111-1111-4111-8111-111111111111', 'approved']);
});

test('only a synthetic approved no-op can transition to success', async () => {
  const calls = [];
  const repository = new VpnSupervisorRepository({ async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [] }; } });
  await repository.completeNoop('11111111-1111-4111-8111-111111111111');
  assert.match(calls[0].sql, /status='approved'/);
  assert.match(calls[0].sql, /synthetic=true/);
  assert.match(calls[0].sql, /playbook_id='supervisor_acceptance_noop'/);
});
