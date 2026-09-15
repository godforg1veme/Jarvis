const assert = require('node:assert/strict');
const test = require('node:test');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const MEMORY_ID = '44444444-4444-4444-8444-444444444444';
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const INTERACTION_ID = '66666666-6666-4666-8666-666666666666';

function harness(overrides = {}) {
  let active = null;
  const calls = [];
  const interactions = {
    async begin(input) { active = { id: INTERACTION_ID, context: {}, ...input }; calls.push(['begin', input]); return active; },
    async getActive() { return { interaction: active, expired: false }; },
    async consume(input) { if (!active || active.id !== input.id) return null; const value = active; active = null; calls.push(['consume', input]); return value; },
    async cancel(input) { const matches = active && (!input.id || input.id === active.id); if (matches) active = null; calls.push(['cancel', input]); return Boolean(matches); },
  };
  const devices = [{ id: DEVICE_ID, name: 'Домашний ПК', status: 'online', capabilities: { actions: ['file.search'] } }];
  const memories = [{ id: MEMORY_ID, content: 'Я люблю чай' }];
  const documents = [{ id: DOCUMENT_ID, original_name: 'notes.txt', status: 'ready', category: 'text' }];
  const service = new TelegramMenuService({
    interactions,
    ownerTelegramId: '101',
    operationsEnabled: true,
    operationsPublicOrigin: 'https://ops.example.test',
    vpnService: {
      async openMenu(input) { calls.push(['vpn-open', input]); return { answer: 'Выбери VPN-протокол:', buttons: [[{ text: 'H2', data: 'vpn:p:h' }]] }; },
      async handleCallback(context) {
        if (context.data === 'vpn:h:new') return { answer: 'Как назвать?', requestInput: { kind: 'vpn_access_label', context: { protocol: 'hysteria2' } } };
        return null;
      },
      async requestAction(input) { calls.push(['vpn', input]); return { answer: `Создать «${input.arguments.label}»?`, buttons: [[{ text: 'Да', data: 'vpn:confirm:77777777-7777-4777-8777-777777777777' }]] }; },
    },
    deviceService: {
      async list() { return devices; },
      async beginPairing(input) { calls.push(['pair', input]); return { code: 'ABC123' }; },
      async revoke(input) { calls.push(['revoke', input]); return devices[0]; },
    },
    memoryService: {
      async list() { return memories; },
      async remember(input) { calls.push(['remember', input]); return { ok: true }; },
      async correctById(input) { calls.push(['correct', input]); return { ok: true }; },
      async forgetById(input) { calls.push(['forget', input]); return { ok: true }; },
    },
    memoryGalleryService: {
      async handleCallback(data, context) { calls.push(['gallery', { data, userId: context.userId }]); return { answer: 'Галерея открыта.', buttons: [[{ text: 'Назад', data: 'mem:menu' }]] }; },
    },
    knowledgeService: {
      async list() { return documents; },
      async remove(input) { calls.push(['remove', input]); return documents[0]; },
    },
    ...overrides,
  });
  const context = {
    user: { id: USER_ID, role: 'owner' }, telegramUserId: '101', chatId: '101',
    conversation: { id: CONVERSATION_ID }, userId: USER_ID, conversationId: CONVERSATION_ID,
    originChannel: 'telegram', originDeviceId: null,
  };
  return { service, context, calls, getActive: () => active };
}

test('home and Operations are role-aware and use only the configured panel URL', async () => {
  const { service, context, calls } = harness();
  const home = await service.handleMenuAction('home', context);
  assert.equal(home.replyKeyboard.keyboard.flat().some((button) => button.text === '🔐 VPN'), true);
  const panel = await service.handleMenuAction('operations', context);
  assert.equal(panel.buttons[0][0].url, 'https://ops.example.test/ops/');
  await service.handleMenuAction('vpn', context);
  assert.equal(calls.find(([name]) => name === 'vpn-open')[1].userId, USER_ID);

  const member = { ...context, user: { ...context.user, role: 'member' }, telegramUserId: '202' };
  const memberHome = await service.handleMenuAction('home', member);
  assert.equal(memberHome.replyKeyboard.keyboard.flat().some((button) => button.text === '🔐 VPN'), false);
  assert.equal((await service.handleMenuAction('operations', member)).buttons, undefined);
});

test('memory menu exposes the unified gallery and routes it with canonical owner scope', async () => {
  const { service, context, calls } = harness();
  const memory = await service.handleMenuAction('memory', context);
  assert.equal(memory.buttons.some((row) => row.some((button) => button.data === 'gallery:page:0')), true);
  const gallery = await service.handleCallback('gallery:page:0', context);
  assert.equal(gallery.answer, 'Галерея открыта.');
  assert.deepEqual(calls.find(([name]) => name === 'gallery')[1], { data: 'gallery:page:0', userId: USER_ID });
});

test('VPN new-access button asks only for a label and consumes the flow before creating confirmation', async () => {
  const { service, context, calls, getActive } = harness();
  const prompt = await service.handleCallback('vpn:h:new', { ...context, data: 'vpn:h:new' });
  assert.match(prompt.answer, /Как назвать/);
  assert.equal(getActive().context.protocol, 'hysteria2');
  const result = await service.handlePendingText('iPhone Максима', context);
  assert.match(result.answer, /iPhone Максима/);
  assert.equal(getActive(), null);
  assert.deepEqual(calls.filter(([name]) => ['consume', 'vpn'].includes(name)).map(([name]) => name), ['consume', 'vpn']);
});

test('memory input rejects secrets without consuming and handles correction by selected owner ID', async () => {
  const { service, context, calls, getActive } = harness();
  await service.handleCallback('mem:add', context);
  const rejected = await service.handlePendingText('мой пароль qwerty', context);
  assert.match(rejected.answer, /не сохраняю/);
  assert.ok(getActive());
  await service.handlePendingText('Я предпочитаю чай', context);
  assert.equal(calls.some(([name]) => name === 'remember'), true);

  await service.handleCallback(`mem:edit:${MEMORY_ID}`, context);
  await service.handlePendingText('Я люблю кофе', context);
  assert.equal(calls.find(([name]) => name === 'correct')[1].memoryId, MEMORY_ID);
});

test('device pairing and selected Desktop instruction require no slash command', async () => {
  const { service, context, calls } = harness();
  await service.handleCallback('dev:pair', context);
  const paired = await service.handlePendingText('Домашний ПК', context);
  assert.match(paired.answer, /ABC123/);
  assert.equal(calls.find(([name]) => name === 'pair')[1].deviceName, 'Домашний ПК');

  await service.handleCallback(`dev:task:${DEVICE_ID}`, context);
  const task = await service.handlePendingText('Найди отчёт', context);
  assert.deepEqual(task.desktopInstruction, { text: 'Найди отчёт', preferredDeviceId: DEVICE_ID });
});

test('documents and device mutations stay behind owner-scoped inline confirmation', async () => {
  const { service, context, calls } = harness();
  const docPrompt = await service.handleCallback(`doc:del_prompt:${DOCUMENT_ID}`, context);
  assert.equal(docPrompt.buttons[0][0].data, `doc:delete:${DOCUMENT_ID}`);
  await service.handleCallback(`doc:delete:${DOCUMENT_ID}`, context);
  assert.equal(calls.some(([name]) => name === 'remove'), true);

  const revokePrompt = await service.handleCallback(`dev:revoke_prompt:${DEVICE_ID}`, context);
  assert.equal(revokePrompt.buttons[0][0].data, `dev:revoke:${DEVICE_ID}`);
  await service.handleCallback(`dev:revoke:${DEVICE_ID}`, context);
  assert.equal(calls.some(([name]) => name === 'revoke'), true);
});

test('guided Life OS input is consumed before any domain mutation', async () => {
  const order = [];
  const { service, context, calls } = harness({
    lifeOsService: {
      async handlePendingText(value, receivedContext, interaction) {
        order.push('mutate');
        assert.equal(value, 'Проект | Описание');
        assert.equal(receivedContext.user.id, USER_ID);
        assert.equal(interaction.kind, 'life_project_create');
        return { answer: 'Life OS обновлён.' };
      },
    },
  });
  await service.interactions.begin({
    userId: USER_ID, conversationId: CONVERSATION_ID, chatId: '101', kind: 'life_project_create', context: {},
  });
  const originalConsume = service.interactions.consume.bind(service.interactions);
  service.interactions.consume = async (input) => { order.push('consume'); return originalConsume(input); };
  const result = await service.handlePendingText('Проект | Описание', context);
  assert.equal(result.answer, 'Life OS обновлён.');
  assert.deepEqual(order, ['consume', 'mutate']);
  assert.equal(calls.filter(([name]) => name === 'consume').length, 1);
});
