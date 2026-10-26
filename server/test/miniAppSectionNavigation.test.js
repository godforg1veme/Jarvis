const test = require('node:test');
const assert = require('node:assert/strict');
const { sectionNavigation } = require('../src/miniApp/sectionNavigation');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');

function sectionRoute({ actor, services = {}, onList } = {}) {
  let handler;
  let checks = 0;
  registerMiniAppSelfRoutes({
    route(method, path, callback) { if (method === 'GET' && path === '/sections/:permission') handler = callback; },
    async authorize() { checks++; return { actor: typeof actor === 'function' ? actor(checks) : actor }; },
  }, { memoryService: { async list() { onList?.(); return []; } }, ...services });
  return { read: (permission) => handler({ params: { permission } }), checks: () => checks };
}

test('section response emits only configured server navigation after final permission check', async () => {
  const actor = { userId: 'user-a', level: 'member', permissions: ['memory'] };
  const routes = sectionRoute({ actor, services: { getTelegramBotUsername: () => 'ActualBot' } });
  const response = await routes.read('memory');
  assert.equal(routes.checks(), 2);
  assert.deepEqual(response.actions, [{ kind: 'telegram', href: 'https://t.me/ActualBot?start=mini_memory', label: 'Открыть Память в боте' }]);
});

test('revoked section read produces no response or navigation', async () => {
  const routes = sectionRoute({ actor: (check) => ({ userId: 'user-a', level: 'member', permissions: check === 1 ? ['memory'] : [] }),
    services: { getTelegramBotUsername: () => 'ActualBot' } });
  await assert.rejects(routes.read('memory'), { code: 'forbidden' });
});

test('owner downgrade during section read removes privileged links', async () => {
  const routes = sectionRoute({ actor: (check) => ({ userId: 'user-a',
    level: check === 1 ? 'owner' : 'member', permissions: ['operations'] }),
    services: { getTelegramBotUsername: () => 'ActualBot', operationsEnabled: true,
      operationsPublicOrigin: 'https://ops.example.test' } });
  assert.deepEqual((await routes.read('operations')).actions, []);
});

test('bot username failure or unsafe value simply omits Telegram link', async () => {
  for (const getter of [() => { throw Error('pending'); }, () => 'bad/name', () => 'a']) {
    const routes = sectionRoute({ actor: { userId: 'user-a', level: 'member', permissions: ['memory'] },
      services: { getTelegramBotUsername: getter } });
    assert.deepEqual((await routes.read('memory')).actions, []);
  }
});

test('VPN and Operations links require owner; Operations requires strict HTTPS origin', async () => {
  const options = { getTelegramBotUsername: () => 'ActualBot', operationsEnabled: true,
    operationsPublicOrigin: 'https://ops.example.test' };
  assert.deepEqual(sectionNavigation('vpn', { level: 'member' }, options), []);
  assert.deepEqual(sectionNavigation('operations', { level: 'member' }, options), []);
  assert.deepEqual(sectionNavigation('operations', { level: 'owner' }, options).map((item) => item.href),
    ['https://t.me/ActualBot?start=mini_operations', 'https://ops.example.test/ops/']);
  for (const origin of ['http://ops.example.test', 'https://user:pass@ops.example.test',
    'https://ops.example.test/other', 'https://ops.example.test/?x=1', 'https://ops.example.test/#x']) {
    assert.equal(sectionNavigation('operations', { level: 'owner' }, { ...options, operationsPublicOrigin: origin }).length, 1);
  }
  assert.equal(sectionNavigation('operations', { level: 'owner' }, { ...options, operationsEnabled: false }).length, 1);
});

test('Telegram and Mini App share strict Operations URL validation', () => {
  for (const origin of ['http://ops.example.test', 'https://user:pass@ops.example.test',
    'https://ops.example.test/other', 'https://ops.example.test/?x=1', 'https://ops.example.test/#x', 'invalid']) {
    const menu = new TelegramMenuService({ operationsEnabled: true, operationsPublicOrigin: origin });
    assert.equal(menu.operationsPanelUrl, null);
  }
  assert.equal(new TelegramMenuService({ operationsEnabled: true,
    operationsPublicOrigin: 'https://ops.example.test' }).operationsPanelUrl, 'https://ops.example.test/ops/');
});
