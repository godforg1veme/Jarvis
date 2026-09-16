const test = require('node:test');
const assert = require('node:assert/strict');
const { VpnCommandService, menuButtons, parseVpnCallback, parseVpnCommand } = require('../src/vpn/vpnCommandService');
const { vpnReplyMarkup } = require('../src/telegram/bot');

test('menuButtons includes smart subscription button', () => {
  const buttons = menuButtons();
  const flat = buttons.flat();
  const subBtn = flat.find((b) => b.data === 'vpn:sub:menu');
  assert.ok(subBtn, 'vpn:sub:menu button must exist');
  assert.match(subBtn.text, /подписки/i);
});

test('parseVpnCommand and parseVpnCallback handle subscription commands', () => {
  assert.deepEqual(parseVpnCommand('/vpn_sub'), { kind: 'subscription', action: 'menu' });
  assert.deepEqual(parseVpnCommand('/vpn_subscriptions'), { kind: 'subscription', action: 'menu' });

  assert.deepEqual(parseVpnCallback('vpn:sub:menu'), { action: 'sub-menu' });
  assert.deepEqual(parseVpnCallback('vpn:sub:new'), { action: 'sub-new' });
  assert.deepEqual(parseVpnCallback('vpn:sub:view:11111111-2222-3333-4444-555555555555'), {
    action: 'sub-view',
    subscriptionId: '11111111-2222-3333-4444-555555555555',
  });
  assert.deepEqual(parseVpnCallback('vpn:sub:rotate:11111111-2222-3333-4444-555555555555'), {
    action: 'sub-rotate',
    subscriptionId: '11111111-2222-3333-4444-555555555555',
  });
  assert.deepEqual(parseVpnCallback('vpn:sub:revoke:11111111-2222-3333-4444-555555555555'), {
    action: 'sub-revoke',
    subscriptionId: '11111111-2222-3333-4444-555555555555',
  });
});

test('vpnReplyMarkup accepts happ-sub URL buttons', () => {
  const buttons = [
    [{ text: '🚀 Активировать в Happ', url: 'https://jarvis.rilora.ru/happ-sub/sub_1234567890abcdef1234567890abcdef' }],
    [{ text: '« К подпискам', data: 'vpn:sub:menu' }],
  ];
  const markup = vpnReplyMarkup(buttons);
  assert.equal(markup.inline_keyboard[0][0].url, 'https://jarvis.rilora.ru/happ-sub/sub_1234567890abcdef1234567890abcdef');
  assert.equal(markup.inline_keyboard[1][0].callback_data, 'vpn:sub:menu');
});

test('VpnCommandService handles sub-menu, sub-new, sub-rotate, and sub-revoke flows', async () => {
  const mockSubscriptions = [];
  const mockRepo = {
    async findById(id) {
      return mockSubscriptions.find((s) => s.id === id) || null;
    },
    async listByUser(userId) {
      return mockSubscriptions.filter((s) => s.userId === userId && !s.revokedAt);
    },
    async revoke({ id, userId }) {
      const sub = mockSubscriptions.find ((s) => s.id === id && s.userId === userId);
      if (sub) sub.revokedAt = new Date().toISOString();
      return true;
    },
  };

  const mockSubService = {
    repository: mockRepo,
    hasCompleteClientBinding(item) { return Boolean(item.clientIdDe && item.clientIdNl); },
    async listSubscriptions(userId) {
      return mockRepo.listByUser(userId);
    },
    async createSubscription({ userId, label }) {
      const id = '11111111-2222-3333-4444-555555555555';
      const token = 'sub_testtoken12345';
      const item = {
        id,
        userId,
        label,
        token,
        url: 'https://jarvis.rilora.ru/sub/' + token,
        happUrl: 'https://jarvis.rilora.ru/happ-sub/' + token,
        createdAt: new Date().toISOString(),
        revokedAt: null,
      };
      mockSubscriptions.push(item);
      return item;
    },
    async rotateSubscription({ id, userId }) {
      const sub = mockSubscriptions.find((s) => s.id === id && s.userId === userId);
      if (!sub) return null;
      const newToken = 'sub_rotatedtoken67890';
      sub.token = newToken;
      sub.url = 'https://jarvis.rilora.ru/sub/' + newToken;
      sub.happUrl = 'https://jarvis.rilora.ru/happ-sub/' + newToken;
      return sub;
    },
    async revokeSubscription({ id, userId }) {
      return mockRepo.revoke({ id, userId });
    },
  };

  const service = new VpnCommandService({
    ownerTelegramId: '100',
    repository: {
      async isOwner() { return true; },
    },
    subscriptionService: mockSubService,
  });

  // 1. Initial menu with 0 subscriptions -> prompts to create
  const menuRes = await service.handleCallback({ data: 'vpn:sub:menu', userId: '100' });
  assert.match(menuRes.answer, /Подписок пока нет/i);
  assert.equal(menuRes.buttons[0][0].data, 'vpn:sub:new');

  // 2. Create subscription
  const createRes = await service.handleCallback({ data: 'vpn:sub:new', userId: '100' });
  assert.match(createRes.answer, /Профиль.*создан/i);
  assert.match(createRes.answer, /бот пришлёт ссылку/i);
  assert.equal(createRes.buttons[0][0].data, 'vpn:sub:repair:11111111-2222-3333-4444-555555555555');

  // 3. The subscription entry stays a list even with one active profile.
  const oneProfileMenu = await service.handleCallback({ data: 'vpn:sub:menu', userId: '100' });
  assert.match(oneProfileMenu.answer, /Ваши подписки/i);
  assert.equal(oneProfileMenu.buttons[0][0].data, 'vpn:sub:view:11111111-2222-3333-4444-555555555555');

  // 4. Both command aliases enter that same list.
  for (const text of ['/vpn_sub', '/vpn_subscriptions']) {
    const result = await service.handle({ text, userId: '100' });
    assert.match(result.answer, /Ваши подписки/i);
  }

  // 5. An unbound profile does not issue a link.
  const unbound = await service.handleCallback({
    data: 'vpn:sub:rotate:11111111-2222-3333-4444-555555555555', userId: '100',
  });
  assert.match(unbound.answer, /Сначала подключите/);

  // 6. Rotate after binding.
  mockSubscriptions[0].clientIdDe = { hy2: 'vpn-000000000001', vless: 'vpn-000000000002' };
  mockSubscriptions[0].clientIdNl = { hy2: 'vpn-000000000003', vless: 'vpn-000000000004' };
  const rotateRes = await service.handleCallback({
    data: 'vpn:sub:rotate:11111111-2222-3333-4444-555555555555',
    userId: '100',
  });
  assert.match(rotateRes.answer, /Новая ссылка/i);
  assert.match(rotateRes.answer, /замените её в Happ на каждом устройстве/i);
  assert.equal(rotateRes.historyAnswer.includes('sub_rotatedtoken'), false);
  assert.equal(rotateRes.buttons[0][0].url, 'https://jarvis.rilora.ru/happ-sub/sub_rotatedtoken67890');

  // 7. Revoke subscription
  const revokeRes = await service.handleCallback({
    data: 'vpn:sub:revoke:11111111-2222-3333-4444-555555555555',
    userId: '100',
  });
  assert.match(revokeRes.answer, /Подписка отозвана/i);

  // 8. Menu after revoke has 0 active
  const menuAfterRes = await service.handleCallback({ data: 'vpn:sub:menu', userId: '100' });
  assert.match(menuAfterRes.answer, /Подписок пока нет/i);
});

test('repair confirmation binds exactly four issued clients and blocks a repeated repair', async () => {
  const subscriptionId = '11111111-2222-3333-4444-555555555555';
  const actionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sub = { id: subscriptionId, userId: 'owner', label: 'Phone', revokedAt: null };
  const calls = [];
  const repository = {
    async isOwner() { return true; },
    async hasUnresolvedSubscriptionRepair() { return false; },
    async create(input) { return { ...input, id: actionId }; },
    async approve() { return { id: actionId, action: 'subscription.repair', arguments: { subscriptionId } }; },
    async complete(value) { calls.push(value); },
    async audit() {},
  };
  const subscriptionService = {
    repository: { async findById() { return sub; } },
    hasCompleteClientBinding(item) { return Boolean(item.clientIdDe && item.clientIdNl); },
    async bindClientIds({ clientIds }) { sub.clientIdDe = clientIds.de; sub.clientIdNl = clientIds.nl; return sub; },
    async rotateSubscription() { return { url: 'https://jarvis.rilora.ru/sub/sub_test_only', happUrl: 'https://jarvis.rilora.ru/happ-sub/sub_test_only' }; },
  };
  let number = 0;
  const issue = async () => ({ result: { state: 'succeeded', data: { client: { id: `vpn-${String(++number).padStart(12, '0')}` } } } });
  const service = new VpnCommandService({ repository, subscriptionService, clients: { de: { request: issue }, nl: { request: issue } } });
  const context = { userId: 'owner', originChannel: 'telegram', conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const prompt = await service.handleCallback({ ...context, data: `vpn:sub:repair:${subscriptionId}` });
  assert.match(prompt.answer, /Подключить четыре сервера/);
  const result = await service.handleCallback({ ...context, data: `vpn:confirm:${actionId}` });
  assert.match(result.answer, /Четыре сервера подключены/);
  assert.match(result.answer, /https:\/\/jarvis\.rilora\.ru\/sub\/sub_test_only/);
  assert.equal(result.buttons[0][0].url, 'https://jarvis.rilora.ru/happ-sub/sub_test_only');
  assert.equal(result.historyAnswer.includes('sub_test_only'), false);
  assert.equal(number, 4);
  assert.equal(calls.at(-1).status, 'succeeded');
  const repeat = await service.handleCallback({ ...context, data: `vpn:sub:repair:${subscriptionId}` });
  assert.match(repeat.answer, /уже подключены/);
  assert.equal(number, 4);
});
