const assert = require('node:assert/strict');
const test = require('node:test');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');
const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { VpnCommandService } = require('../src/vpn/vpnCommandService');
const { VpnSubscriptionRepository } = require('../src/vpn/vpnSubscriptionRepository');
const { VpnSubscriptionService } = require('../src/vpn/vpnSubscriptionService');

const TELEGRAM_OWNER_ID = '101';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const SUBSCRIPTION_ID = '33333333-3333-4333-8333-333333333333';

function rows(values = []) {
  return { rows: values, rowCount: values.length };
}

function createDatabase() {
  const interactions = new Map();
  const subscriptions = new Map();

  async function query(sql, params = []) {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return rows();
    if (statement.startsWith('SELECT pg_advisory_xact_lock')) return rows();

    if (statement.includes("UPDATE telegram_interactions SET status='cancelled'")) {
      const [userId, conversationId, chatId, id] = params;
      const changedIds = [];
      for (const interaction of interactions.values()) {
        if (interaction.user_id !== userId || interaction.conversation_id !== conversationId || interaction.status !== 'active') continue;
        if (params.length > 2 && interaction.chat_id !== String(chatId)) continue;
        if (id && interaction.id !== id) continue;
        interaction.status = 'cancelled';
        changedIds.push(interaction.id);
      }
      return rows(changedIds.map((changedId) => ({ id: changedId })));
    }

    if (statement.includes('INSERT INTO telegram_interactions')) {
      const [id, userId, conversationId, chatId, kind, context, expiresAt] = params;
      const interaction = {
        id, user_id: userId, conversation_id: conversationId, chat_id: String(chatId),
        kind, context: JSON.parse(context), status: 'active', expires_at: expiresAt,
      };
      interactions.set(id, interaction);
      return rows([{ ...interaction }]);
    }

    if (statement.includes("UPDATE telegram_interactions SET status='expired'")) {
      const [userId, conversationId, chatId] = params;
      const expired = [];
      for (const interaction of interactions.values()) {
        if (interaction.user_id === userId && interaction.conversation_id === conversationId
          && interaction.chat_id === String(chatId) && interaction.status === 'active'
          && new Date(interaction.expires_at).getTime() <= Date.now()) {
          interaction.status = 'expired';
          expired.push({ id: interaction.id });
        }
      }
      return rows(expired);
    }

    if (statement.includes("UPDATE telegram_interactions SET status='consumed'")) {
      const [id, userId, conversationId, chatId] = params;
      const interaction = interactions.get(id);
      if (!interaction || interaction.user_id !== userId || interaction.conversation_id !== conversationId
        || interaction.chat_id !== String(chatId) || interaction.status !== 'active'
        || new Date(interaction.expires_at).getTime() <= Date.now()) return rows();
      interaction.status = 'consumed';
      return rows([{ ...interaction }]);
    }

    if (statement.startsWith('SELECT * FROM telegram_interactions')) {
      const [userId, conversationId, chatId] = params;
      const active = [...interactions.values()].filter((item) => item.user_id === userId
        && item.conversation_id === conversationId && item.chat_id === String(chatId)
        && item.status === 'active' && new Date(item.expires_at).getTime() > Date.now());
      return rows(active.slice(-1));
    }

    if (statement.includes('INSERT INTO vpn_subscriptions')) {
      const [userId, label, tokenHash, clientIdDe, clientIdNl, createdBy] = params;
      const subscription = {
        id: SUBSCRIPTION_ID, user_id: userId, label, token_hash: tokenHash,
        client_id_de: clientIdDe, client_id_nl: clientIdNl, created_by: createdBy,
        created_at: new Date(), revoked_at: null,
      };
      subscriptions.set(subscription.id, subscription);
      return rows([{ ...subscription }]);
    }

    if (statement.startsWith('SELECT * FROM vpn_subscriptions WHERE id = $1')) {
      const subscription = subscriptions.get(params[0]);
      return rows(subscription ? [{ ...subscription }] : []);
    }

    if (statement.startsWith('SELECT * FROM vpn_subscriptions WHERE user_id = $1')) {
      const [userId] = params;
      const activeOnly = statement.includes('revoked_at IS NULL');
      const result = [...subscriptions.values()].filter((item) => item.user_id === userId && (!activeOnly || !item.revoked_at));
      return rows(result.map((item) => ({ ...item })));
    }

    if (statement.includes('UPDATE vpn_subscriptions SET client_id_de=$1')) {
      const [clientIdDe, clientIdNl, id, userId] = params;
      const subscription = subscriptions.get(id);
      if (!subscription || subscription.user_id !== userId || subscription.revoked_at
        || subscription.client_id_de !== null || subscription.client_id_nl !== null) return rows();
      subscription.client_id_de = clientIdDe;
      subscription.client_id_nl = clientIdNl;
      return rows([{ ...subscription }]);
    }

    if (statement.includes('UPDATE vpn_subscriptions SET label = $1')) {
      const [label, id, userId] = params;
      const subscription = subscriptions.get(id);
      if (!subscription || subscription.user_id !== userId || subscription.revoked_at) return rows();
      subscription.label = label;
      return rows([{ ...subscription }]);
    }

    if (statement.includes('UPDATE vpn_subscriptions SET token_hash = $1')) {
      const [tokenHash, id, userId] = params;
      const subscription = subscriptions.get(id);
      if (!subscription || subscription.user_id !== userId || subscription.revoked_at) return rows();
      subscription.token_hash = tokenHash;
      return rows([{ ...subscription }]);
    }

    throw new Error('Unexpected SQL in Telegram subscription E2E: ' + statement.slice(0, 80));
  }

  const pool = {
    query,
    async connect() {
      return { query, release() {} };
    },
  };

  return {
    pool,
    interactions,
    subscriptions,
    findSubscription(id) { return subscriptions.get(id) || null; },
  };
}

function callbackUpdate(updateId, data, telegramUserId = TELEGRAM_OWNER_ID) {
  return {
    update_id: updateId,
    callback_query: {
      id: 'callback-' + updateId,
      from: { id: telegramUserId, first_name: 'Owner' },
      message: { message_id: updateId + 100, chat: { id: TELEGRAM_OWNER_ID } },
      data,
    },
  };
}

function messageUpdate(updateId, text) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 100,
      from: { id: TELEGRAM_OWNER_ID, first_name: 'Owner' },
      chat: { id: TELEGRAM_OWNER_ID },
      text,
    },
  };
}

test('Telegram button path creates, binds, and renames a Happ subscription profile', async () => {
  const database = createDatabase();
  const interactions = new TelegramInteractionRepository(database.pool);
  const subscriptions = new VpnSubscriptionRepository(database.pool);
  const subscriptionService = new VpnSubscriptionService({ repository: subscriptions });
  const hostCalls = [];
  let issuedClient = 0;
  let pendingAction = null;
  const vpnRepository = {
    async isOwner({ userId, ownerTelegramId }) {
      return userId === USER_ID && ownerTelegramId === TELEGRAM_OWNER_ID;
    },
    async hasUnresolvedSubscriptionRepair() { return false; },
    async create(action) {
      pendingAction = { ...action };
      return pendingAction;
    },
    async approve({ userId, requestId }) {
      if (!pendingAction || pendingAction.id !== requestId || pendingAction.userId !== userId) return null;
      const approved = pendingAction;
      pendingAction = null;
      return approved;
    },
    async complete(result) { hostCalls.push({ completed: result }); },
    async audit() {},
  };
  const hostAgent = {
    async request(request) {
      hostCalls.push({ operation: request.operation });
      issuedClient += 1;
      return { result: { state: 'succeeded', data: { client: { id: 'vpn-' + String(issuedClient).padStart(12, '0') } } } };
    },
  };
  const vpnService = new VpnCommandService({
    ownerTelegramId: TELEGRAM_OWNER_ID,
    repository: vpnRepository,
    subscriptionService,
    clients: { de: hostAgent, nl: hostAgent },
  });
  const menuService = new TelegramMenuService({ interactions, ownerTelegramId: TELEGRAM_OWNER_ID, vpnService });
  const state = { updates: new Set(), messages: [] };
  const telegram = new TelegramMessageService({
    accessPolicy: createTelegramAccessPolicy([TELEGRAM_OWNER_ID]),
    updateRepository: {
      async claim(updateId) {
        if (state.updates.has(updateId)) return false;
        state.updates.add(updateId);
        return true;
      },
      async markCompleted() {},
      async markFailed(_updateId, code) { state.failureCode = code; },
    },
    userRepository: {
      async findOrCreateTelegramUser() { return { id: USER_ID, role: 'owner' }; },
    },
    conversationRepository: {
      async getOrCreate() { return { id: CONVERSATION_ID }; },
      async appendMessage(message) { state.messages.push(message); },
    },
    assistant: { async answer() { return 'Обычный ответ.'; } },
    menuService,
  });

  const createPrompt = await telegram.handleCallback(callbackUpdate(1, 'vpn:sub:new'));
  assert.equal(createPrompt.status, 'answered');
  assert.match(createPrompt.answer, /Как назвать подписку/);
  assert.match(createPrompt.buttons[0][0].data, /^flow:cancel:/);
  assert.equal([...database.interactions.values()].at(-1).kind, 'vpn_subscription_create_label');

  assert.equal((await interactions.getActive({ userId: USER_ID, conversationId: CONVERSATION_ID, chatId: '999' })).interaction, null);
  assert.equal((await interactions.getActive({ userId: OTHER_USER_ID, conversationId: CONVERSATION_ID, chatId: TELEGRAM_OWNER_ID })).interaction, null);
  assert.equal((await interactions.getActive({ userId: USER_ID, conversationId: '55555555-5555-4555-8555-555555555555', chatId: TELEGRAM_OWNER_ID })).interaction, null);

  const invalidName = await telegram.handle(messageUpdate(2, 'Слишком длинное имя подписки для Happ'));
  assert.equal(invalidName.status, 'answered');
  assert.match(invalidName.answer, /25/);
  assert.equal(state.failureCode, undefined);
  assert.equal([...database.interactions.values()].at(-1).status, 'active');
  assert.equal(database.subscriptions.size, 0);

  const created = await telegram.handle(messageUpdate(3, 'Мой iPhone'));
  assert.equal(created.status, 'answered');
  assert.match(created.answer, /Профиль «Мой iPhone» создан/);
  assert.equal(created.buttons[0][0].data, 'vpn:sub:repair:' + SUBSCRIPTION_ID);
  assert.equal(database.subscriptions.size, 1);
  assert.equal([...database.interactions.values()].at(-1).status, 'consumed');
  assert.equal((await telegram.handle(messageUpdate(3, 'Мой iPhone'))).status, 'duplicate');
  assert.equal(database.subscriptions.size, 1);

  const repairPrompt = await telegram.handleCallback(callbackUpdate(4, created.buttons[0][0].data));
  assert.match(repairPrompt.answer, /Подключить четыре сервера/);
  assert.match(repairPrompt.buttons[0][0].data, /^vpn:confirm:/);
  const repaired = await telegram.handleCallback(callbackUpdate(5, repairPrompt.buttons[0][0].data));
  assert.match(repaired.answer, /Четыре сервера подключены/);
  assert.equal(issuedClient, 4);
  assert.deepEqual(hostCalls.filter((call) => call.operation).map((call) => call.operation), [
    'vpn.hysteria2.client.issue',
    'vpn.client.issue',
    'vpn.hysteria2.client.issue',
    'vpn.client.issue',
  ]);
  assert.equal(hostCalls.find((call) => call.completed)?.completed.status, 'succeeded');
  const beforeRename = database.findSubscription(SUBSCRIPTION_ID);
  const boundDe = JSON.parse(beforeRename.client_id_de);
  const boundNl = JSON.parse(beforeRename.client_id_nl);
  const tokenHash = beforeRename.token_hash;
  assert.deepEqual(boundDe, { hy2: 'vpn-000000000001', vless: 'vpn-000000000002' });
  assert.deepEqual(boundNl, { hy2: 'vpn-000000000003', vless: 'vpn-000000000004' });
  const deliveredToken = /\/sub\/(sub_[a-f0-9]{64})/.exec(repaired.answer)?.[1];
  assert.ok(deliveredToken, 'repair response should deliver the new Happ subscription link');
  assert.equal(state.messages.some((message) => String(message.content).includes(deliveredToken)), false);

  const profile = await telegram.handleCallback(callbackUpdate(6, 'vpn:sub:view:' + SUBSCRIPTION_ID));
  assert.match(profile.answer, /Мой iPhone/);
  const renameData = profile.buttons.flat().find((button) => button.data === 'vpn:sub:rename:' + SUBSCRIPTION_ID)?.data;
  assert.ok(renameData);
  const renamePrompt = await telegram.handleCallback(callbackUpdate(7, renameData));
  assert.match(renamePrompt.answer, /Новое имя/);
  const pendingRename = [...database.interactions.values()].at(-1);
  assert.equal(pendingRename.kind, 'vpn_subscription_rename_label');
  assert.deepEqual(pendingRename.context, { subscriptionId: SUBSCRIPTION_ID });

  const invalidRename = await telegram.handle(messageUpdate(8, 'Слишком длинное имя подписки для Happ'));
  assert.equal(invalidRename.status, 'answered');
  assert.match(invalidRename.answer, /25/);
  assert.equal([...database.interactions.values()].at(-1).status, 'active');
  assert.equal(database.subscriptions.size, 1);
  assert.equal(database.findSubscription(SUBSCRIPTION_ID).label, 'Мой iPhone');
  assert.equal(database.findSubscription(SUBSCRIPTION_ID).token_hash, tokenHash);
  assert.deepEqual(JSON.parse(database.findSubscription(SUBSCRIPTION_ID).client_id_de), boundDe);
  assert.deepEqual(JSON.parse(database.findSubscription(SUBSCRIPTION_ID).client_id_nl), boundNl);
  assert.equal(state.failureCode, undefined);

  const renamed = await telegram.handle(messageUpdate(9, 'Рабочий iPhone'));
  assert.equal(renamed.status, 'answered');
  assert.match(renamed.answer, /Подписка переименована/);
  assert.equal(database.findSubscription(SUBSCRIPTION_ID).label, 'Рабочий iPhone');
  assert.equal(database.findSubscription(SUBSCRIPTION_ID).token_hash, tokenHash);
  assert.deepEqual(JSON.parse(database.findSubscription(SUBSCRIPTION_ID).client_id_de), boundDe);
  assert.deepEqual(JSON.parse(database.findSubscription(SUBSCRIPTION_ID).client_id_nl), boundNl);

  const renamedProfile = await telegram.handleCallback(callbackUpdate(10, 'vpn:sub:view:' + SUBSCRIPTION_ID));
  assert.match(renamedProfile.answer, /Рабочий iPhone/);
  const unauthorized = await telegram.handleCallback(callbackUpdate(11, 'vpn:sub:rename:' + SUBSCRIPTION_ID, '202'));
  assert.equal(unauthorized.status, 'forbidden');
  assert.equal(database.findSubscription(SUBSCRIPTION_ID).label, 'Рабочий iPhone');
  assert.equal(state.failureCode, undefined);
});
