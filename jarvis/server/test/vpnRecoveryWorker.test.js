const assert = require('node:assert/strict');
const test = require('node:test');

const { VpnRecoveryWorker } = require('../src/vpn/vpnRecoveryWorker');

function original(requestId, state = 'succeeded') {
  return {
    version: 1,
    requestId,
    operation: 'vpn.client.issue',
    receivedAt: '2026-09-12T10:00:00.000Z',
    completedAt: '2026-09-12T10:00:01.000Z',
    result: {
      state,
      data: {
        client: { id: 'vpn-123456abcdef', label: 'Phone', createdAt: '2026-09-12T10:00:00Z' },
        shareUri: 'vless://must-not-be-persisted',
      },
      ...(state === 'failed' ? { errorCode: 'XRAY_RESTART_FAILED' } : {}),
    },
  };
}

test('reconciles a completed action without persisting its share URI', async () => {
  const completed = [];
  const audited = [];
  const repository = {
    complete: async (value) => completed.push(value),
    audit: async (value) => audited.push(value),
  };
  const worker = new VpnRecoveryWorker({
    repository,
    client: { request: async (request) => ({ result: { state: 'succeeded', data: { response: original(request.arguments.requestId) } } }) },
  });
  const changed = await worker.reconcile({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: 'u1', action: 'issue' });
  assert.equal(changed, true);
  assert.equal(completed[0].status, 'succeeded');
  assert.equal(JSON.stringify(completed[0]).includes('vless://'), false);
  assert.equal(audited[0].type, 'vpn.action.recovered');
});

test('leaves an unclaimed action recoverable', async () => {
  const worker = new VpnRecoveryWorker({
    repository: { complete: async () => assert.fail('must not complete'), audit: async () => {} },
    client: { request: async () => ({ result: { state: 'succeeded', data: { found: false, response: null } } }) },
  });
  assert.equal(await worker.reconcile({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: 'u1', action: 'restart' }), false);
});
