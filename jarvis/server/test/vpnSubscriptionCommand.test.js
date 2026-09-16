const test = require('node:test');
const assert = require('node:assert/strict');
const { VpnCommandService, menuButtons, parseVpnCallback, parseVpnCommand } = require('../src/vpn/vpnCommandService');
const { vpnReplyMarkup } = require('../src/telegram/bot');

test('menuButtons includes smart subscription button', () => {
  const buttons = menuButtons();
  const flat = buttons.flat();
  const subBtn = flat.find((b) => b.data === 'vpn:sub:menu');
  assert.ok(subBtn, 'vpn:sub:menu button must exist');
  assert.match(subBtn.text, /подписка/i);
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
  assert.match(menuRes.answer, /у вас пока нет активных подписок/i);
  assert.equal(menuRes.buttons[0][0].data, 'vpn:sub:new');

  // 2. Create subscription
  const createRes = await service.handleCallback({ data: 'vpn:sub:new', userId: '100' });
  assert.match(createRes.answer, /Умная подписка Jarvis VPN создана/i);
  assert.equal(createRes.buttons[0][0].url, 'https://jarvis.rilora.ru/happ-sub/sub_testtoken12345');

  // 3. Rotate token
  const rotateRes = await service.handleCallback({
    data: 'vpn:sub:rotate:11111111-2222-3333-4444-555555555555',
    userId: '100',
  });
  assert.match(rotateRes.answer, /Токен подписки обновлен/i);
  assert.equal(rotateRes.buttons[0][0].url, 'https://jarvis.rilora.ru/happ-sub/sub_rotatedtoken67890');

  // 4. Revoke subscription
  const revokeRes = await service.handleCallback({
    data: 'vpn:sub:revoke:11111111-2222-3333-4444-555555555555',
    userId: '100',
  });
  assert.match(revokeRes.answer, /Подписка отозвана/i);

  // 5. Menu after revoke has 0 active
  const menuAfterRes = await service.handleCallback({ data: 'vpn:sub:menu', userId: '100' });
  assert.match(menuAfterRes.answer, /у вас пока нет активных подписок/i);
});
