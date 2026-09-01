const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');

test('Telegram update claim uses parameterized SQL', async () => {
  const calls = [];
  const repository = new TelegramUpdateRepository({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [{ update_id: values[0] }] };
    },
  });
  assert.equal(await repository.claim(42, '123'), true);
  assert.deepEqual(calls[0].values, [42, '123']);
  assert.equal(calls[0].sql.includes('123'), false);
});

test('message insert scopes the conversation by user ID', async () => {
  const calls = [];
  const repository = new ConversationRepository({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [{ id: 1 }] };
    },
  });
  await repository.appendMessage({
    userId: 'user-a',
    conversationId: 'conversation-a',
    role: 'user',
    content: 'hello',
    externalMessageId: 'message-1',
  });
  assert.match(calls[0].sql, /c\.user_id = \$1/);
  assert.deepEqual(calls[0].values, ['user-a', 'user', 'text', 'hello', 'message-1', 'conversation-a']);
});

test('recent messages always filter by user and conversation', async () => {
  const calls = [];
  const repository = new ConversationRepository({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rowCount: 0, rows: [] };
    },
  });
  await repository.recentMessages({ userId: 'user-a', conversationId: 'conversation-a', limit: 1000 });
  assert.match(calls[0].sql, /user_id = \$1 AND conversation_id = \$2/);
  assert.deepEqual(calls[0].values, ['user-a', 'conversation-a', 100]);
});
