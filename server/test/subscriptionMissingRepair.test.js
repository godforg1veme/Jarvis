const test = require('node:test');
const assert = require('node:assert/strict');
const { VpnCommandService } = require('../src/vpn/vpnCommandService');

for (const failure of [null, 'export', 'transport', 'bind']) {
  test(`bound subscription repair preserves other bindings and token: ${failure || 'success'}`, async () => {
    const sub = { id: '11111111-2222-4333-8444-555555555555', userId: 'owner', label: 'Fixture',
      client_id_de: JSON.stringify({ hy2: 'vpn-aaaaaaaaaaaa', vless: 'vpn-bbbbbbbbbbbb' }),
      client_id_nl: JSON.stringify({ hy2: 'vpn-cccccccccccc', vless: 'vpn-dddddddddddd' }), tokenHash: 'unchanged' };
    const context = { userId: 'owner', originChannel: 'telegram', chatType: 'private', conversationId: 'chat-fixture' };
    let pending, approved = false, status, issues = 0, issuedId;
    const checkpoints = [];
    const repository = {
      async isOwner({ userId }) { return userId === 'owner'; },
      async hasUnresolvedSubscriptionRepair() { return Boolean(pending); },
      async create(input) { pending = input; return input; },
      async approve(scope) {
        if (approved || scope.conversationId !== context.conversationId) return null;
        approved = true; return pending;
      },
      async complete(value) { status = value.status; checkpoints.push(JSON.parse(JSON.stringify(value))); },
      async audit() {},
    };
    const request = async (req) => {
      if (req.operation.endsWith('.export')) {
        if (failure === 'export') throw new Error('unavailable');
        return req.arguments.clientId === 'vpn-aaaaaaaaaaaa'
          ? { result: { state: 'failed', errorCode: 'VPN_CLIENT_NOT_FOUND' } }
          : { result: { state: 'succeeded', data: { shareUri: 'fixture-only' } } };
      }
      assert.equal(req.operation, 'vpn.hysteria2.client.issue');
      assert.equal(checkpoints.at(-1).result.operations[0].requestId, req.requestId);
      issuedId = req.requestId; issues++;
      if (failure === 'transport') throw new Error('uncertain');
      return { result: { state: 'succeeded', data: { client: { id: 'vpn-eeeeeeeeeeee' } } } };
    };
    const service = new VpnCommandService({ repository, clients: { de: { request }, nl: { request } },
      subscriptionService: {
        hasCompleteClientBinding() { return true; },
        async rotateSubscription() { assert.fail('token must not rotate'); },
        repository: {
          async findById() { return sub; },
          async replaceBindings({ expected, replacement, userId }) {
            assert.equal(userId, 'owner');
            assert.equal(expected.de.hy2, 'vpn-aaaaaaaaaaaa');
            assert.equal(replacement.de.vless, 'vpn-bbbbbbbbbbbb');
            assert.deepEqual(replacement.nl, JSON.parse(sub.client_id_nl));
            if (failure === 'bind') return null;
            sub.client_id_de = JSON.stringify(replacement.de); return sub;
          },
        },
      },
    });
    const prompt = await service.handleCallback({ ...context, data: `vpn:sub:repair:${sub.id}` });
    assert.equal(issues, 0);
    if (failure === 'export') { assert.equal(pending, undefined); return; }
    assert.match(prompt.answer, /Ссылка подписки сохранится/);
    const confirm = `vpn:confirm:${pending.id}`;
    await assert.rejects(service.handleCallback({ ...context, conversationId: 'foreign-chat', data: confirm }), /VPN_CONFIRMATION_UNAVAILABLE/);
    assert.equal(issues, 0);
    const result = await service.handleCallback({ ...context, data: confirm });
    assert.equal(issues, 1);
    assert.ok(issuedId);
    assert.equal(status, failure ? 'unknown' : 'succeeded');
    if (!failure) assert.match(result.answer, /прежней ссылке/);
    await assert.rejects(service.handleCallback({ ...context, data: confirm }), /VPN_CONFIRMATION_UNAVAILABLE/);
    await service.handleCallback({ ...context, data: `vpn:sub:repair:${sub.id}` });
    assert.equal(issues, 1);
    assert.equal(sub.tokenHash, 'unchanged');
  });
}
