'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { VpnSupervisorCallbackRouter } = require('../src/operations/vpnSupervisor/callbackRouter');

const OWNER = '101';
const CHAT = '101';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const HOST_IDS = {
  de: '11111111-1111-4111-8111-111111111111',
  nl: '33333333-3333-4333-8333-333333333333',
  future: '44444444-4444-4444-8444-444444444444',
};

function fixture({ hostId = HOST_IDS.nl, services = HOST_IDS } = {}) {
  let lookups = 0;
  const calls = [];
  const repository = {
    async find(id) {
      lookups += 1;
      assert.equal(id, RUN_ID);
      return hostId ? { id, host_id: hostId } : null;
    },
  };
  const registeredServices = Object.entries(services).map(([name, id]) => ({
    hostIdProvider: async () => ({ id }),
    async handleCallback(input) {
      calls.push([name, input.data]);
      return { answer: `handled:${name}` };
    },
  }));
  const router = new VpnSupervisorCallbackRouter({ repository, services: registeredServices, ownerTelegramId: OWNER });
  return { router, calls, get lookups() { return lookups; } };
}

for (const action of ['details', 'reject', 'allow']) {
  for (const node of ['de', 'nl', 'future']) {
    test(`routes ${action} for registered ${node} runs by persisted host_id`, async () => {
      const current = fixture({ hostId: HOST_IDS[node] });
      const data = `vpsup:${action}:${RUN_ID}`;
      const result = await current.router.handleCallback({ data, telegramUserId: OWNER, telegramChatId: CHAT });
      assert.deepEqual(result, { answer: `handled:${node}` });
      assert.deepEqual(current.calls, [[node, data]]);
      assert.equal(current.lookups, 1);
    });
  }
}

test('rejects malformed callbacks without looking up runs', async () => {
  const current = fixture();
  assert.equal(await current.router.handleCallback({ data: 'vpsup:allow:not-a-uuid', telegramUserId: OWNER, telegramChatId: CHAT }), null);
  assert.equal(current.lookups, 0);
  assert.equal(current.calls.length, 0);
});

test('checks owner and private chat before reading shared run state', async () => {
  const wrongOwner = fixture();
  assert.match((await wrongOwner.router.handleCallback({ data: `vpsup:details:${RUN_ID}`, telegramUserId: '202', telegramChatId: '202' })).answer, /только владельцу/);
  assert.equal(wrongOwner.lookups, 0);

  const wrongChat = fixture();
  assert.match((await wrongChat.router.handleCallback({ data: `vpsup:allow:${RUN_ID}`, telegramUserId: OWNER, telegramChatId: '-1001' })).answer, /личном чате владельца/);
  assert.equal(wrongChat.lookups, 0);
});

test('unknown runs and unregistered hosts fail closed without dispatch', async () => {
  const missing = fixture({ hostId: null });
  assert.match((await missing.router.handleCallback({ data: `vpsup:details:${RUN_ID}`, telegramUserId: OWNER, telegramChatId: CHAT })).answer, /не найден/);
  assert.equal(missing.calls.length, 0);

  const unknown = fixture({ hostId: '55555555-5555-4555-8555-555555555555' });
  assert.match((await unknown.router.handleCallback({ data: `vpsup:allow:${RUN_ID}`, telegramUserId: OWNER, telegramChatId: CHAT })).answer, /не найден/);
  assert.equal(unknown.calls.length, 0);
});

test('repository lookup failure stops before host resolution and callback dispatch', async () => {
  let hostLookups = 0;
  let callbacks = 0;
  const router = new VpnSupervisorCallbackRouter({
    repository: { async find() { throw new Error('database unavailable'); } },
    services: [{
      async hostIdProvider() { hostLookups += 1; return { id: HOST_IDS.nl }; },
      async handleCallback() { callbacks += 1; return { answer: 'unexpected' }; },
    }],
    ownerTelegramId: OWNER,
  });
  await assert.rejects(router.handleCallback({ data: `vpsup:allow:${RUN_ID}`, telegramUserId: OWNER, telegramChatId: CHAT }), /database unavailable/);
  assert.equal(hostLookups, 0);
  assert.equal(callbacks, 0);
});

test('ambiguous host registration fails closed', async () => {
  const current = fixture({ services: { first: HOST_IDS.nl, duplicate: HOST_IDS.nl } });
  assert.match((await current.router.handleCallback({ data: `vpsup:allow:${RUN_ID}`, telegramUserId: OWNER, telegramChatId: CHAT })).answer, /не найден/);
  assert.equal(current.calls.length, 0);
});

test('host lookup failure stops routing before any handler is called', async () => {
  const current = fixture();
  current.router.services[0].hostIdProvider = async () => { throw new Error('private infrastructure details'); };
  await assert.rejects(current.router.handleCallback({ data: `vpsup:allow:${RUN_ID}`, telegramUserId: OWNER, telegramChatId: CHAT }), /private infrastructure details/);
  assert.equal(current.calls.length, 0);
});
