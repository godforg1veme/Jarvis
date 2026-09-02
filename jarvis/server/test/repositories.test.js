const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { DocumentRepository } = require('../src/knowledge/documentRepository');
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

test('document creation locks the owner before enforcing a byte quota', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      const normalized = String(sql).trim();
      calls.push({ sql: normalized, values });
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (normalized.includes('SELECT id FROM users')) return { rowCount: 1, rows: [{ id: 'owner-a' }] };
      if (normalized.includes('COALESCE(SUM(byte_size)')) return { rowCount: 1, rows: [{ byte_size: '100' }] };
      return { rowCount: 1, rows: [{ id: 'document-a' }] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const repository = new DocumentRepository({ async connect() { return client; } });
  await repository.createPending({
    id: 'document-a',
    userId: 'owner-a',
    originalName: 'notes.md',
    mediaType: 'text/markdown',
    storageKey: 'aa/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    byteSize: 12,
    sha256: Buffer.alloc(32),
    category: 'text',
    userQuotaBytes: 200,
    metadata: {},
  });
  assert.match(calls[1].sql, /FROM users WHERE id = \$1 FOR UPDATE/);
  assert.match(calls[2].sql, /WHERE user_id = \$1/);
  assert.deepEqual(calls[1].values, ['owner-a']);
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('document search always scopes the chunk and joined document to its owner', async () => {
  const calls = [];
  const repository = new DocumentRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: 0, rows: [] };
    },
  });
  await repository.search({ userId: 'owner-a', query: 'секрет', limit: 100 });
  assert.match(calls[0].sql, /c\.user_id = \$1/);
  assert.match(calls[0].sql, /d\.id = c\.document_id AND d\.user_id = c\.user_id/);
  assert.deepEqual(calls[0].values, ['owner-a', 'секрет', 40]);
});
