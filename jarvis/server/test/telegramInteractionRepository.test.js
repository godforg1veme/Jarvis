const assert = require('node:assert/strict');
const test = require('node:test');
const { TelegramInteractionRepository, validateContext, validateInteraction } = require('../src/telegram/telegramInteractionRepository');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';

test('accepts only closed bounded Telegram interaction contexts', () => {
  assert.deepEqual(validateContext('vpn_access_label', { protocol: 'hysteria2' }), { protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(validateContext('vpn_access_label', { protocol: 'hysteria2', node: 'nl' }), { protocol: 'hysteria2', node: 'nl' });
  assert.deepEqual(validateContext('device_instruction', { deviceId: DEVICE_ID }), { deviceId: DEVICE_ID });
  assert.throws(() => validateContext('vpn_access_label', { protocol: 'wireguard' }), /invalid/);
  assert.throws(() => validateContext('device_instruction', { deviceId: DEVICE_ID, command: 'delete' }), /invalid/);
  assert.throws(() => validateContext('memory_add', { secret: 'value' }), /invalid/);
});

test('accepts bounded Life OS flows and preference context only', () => {
  assert.deepEqual(validateContext('life_project_create', {}), {});
  assert.deepEqual(validateContext('life_project_update', { targetId: DEVICE_ID, revision: 3 }), { targetId: DEVICE_ID, revision: 3 });
  assert.deepEqual(validateContext('life_preference_set', { key: 'response.style', revision: 2 }), { key: 'response.style', revision: 2 });
  assert.deepEqual(validateContext('life_family_grant_confirm', {
    memberUserId: USER_ID, resourceType: 'project', resourceId: DEVICE_ID, permission: 'view_summary',
  }), { memberUserId: USER_ID, resourceType: 'project', resourceId: DEVICE_ID, permission: 'view_summary' });
  assert.throws(() => validateContext('life_preference_set', { key: 'response.style', revision: 2, value: 'secret' }), /invalid/);
  assert.throws(() => validateContext('life_project_update', { targetId: DEVICE_ID, revision: 0 }), /invalid/);
  assert.throws(() => validateContext('life_family_grant_confirm', {
    memberUserId: USER_ID, resourceType: 'project', resourceId: DEVICE_ID, permission: 'admin',
  }), /invalid/);
});

test('interaction ownership and chat identity are validated before SQL', () => {
  assert.deepEqual(validateInteraction({
    userId: USER_ID, conversationId: CONVERSATION_ID, chatId: '-123', kind: 'memory_add', context: {},
  }), { userId: USER_ID, conversationId: CONVERSATION_ID, chatId: '-123', kind: 'memory_add', context: {} });
  assert.throws(() => validateInteraction({ userId: 'user', conversationId: CONVERSATION_ID, chatId: '1', kind: 'memory_add', context: {} }), /owner/);
  assert.throws(() => validateInteraction({ userId: USER_ID, conversationId: CONVERSATION_ID, chatId: 'chat', kind: 'memory_add', context: {} }), /interaction/);
  assert.throws(() => validateInteraction({ userId: USER_ID, conversationId: CONVERSATION_ID, chatId: '1', kind: 'shell', context: {} }), /interaction/);
});

test('begin serializes a conversation and parameterizes bounded interaction data', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('INSERT INTO telegram_interactions')) return { rows: [{ id: params[0], context: JSON.parse(params[5]) }] };
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const repository = new TelegramInteractionRepository({ async connect() { return client; } }, {
    now: () => new Date('2026-09-14T12:00:00Z'),
  });
  const created = await repository.begin({
    userId: USER_ID, conversationId: CONVERSATION_ID, chatId: '101',
    kind: 'vpn_access_label', context: { protocol: 'hysteria2' },
  });
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(created.context, { protocol: 'hysteria2', node: 'de' });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  assert.ok(calls.find((call) => call.sql.includes("status='cancelled'")).params);
  assert.ok(calls.find((call) => call.sql.includes('INSERT INTO telegram_interactions')).params);
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
