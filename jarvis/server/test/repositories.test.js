const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { DocumentRepository } = require('../src/knowledge/documentRepository');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
const { VpnRepository } = require('../src/vpn/vpnRepository');

test('probe timer gate counts only latest protocol-matched proof for each of four bindings', async () => {
  let sql;
  const repository = new VpnRepository({ async query(statement) { sql = statement; return { rows: [{ count: 0 }] }; } });
  assert.equal(await repository.hasVerifiedProbeBindings(), false);
  assert.match(sql, /DISTINCT ON/);
  assert.match(sql, /probe\.install/);
  assert.match(sql, /probe\.rotate/);
  assert.match(sql, /probe\.recheck/);
  assert.match(sql, /result->>'acceptedCheck'/);
  assert.match(sql, /vless_tcp_8443/);
  assert.match(sql, /hysteria2_udp_hop/);
  assert.match(sql, /completed_at>now\(\)-interval '24 hours'/);
  assert.match(sql, /status='succeeded'/);
  assert.match(sql, /result->>'targetNode'=arguments->>'sourceNode'/);
  assert.match(sql, /result->>'runnerNode'=arguments->>'runnerNode'/);
  assert.match(sql, /result->>'protocol'=arguments->>'protocol'/);
  assert.match(sql, /'de', 'nl', 'vless'/);
  assert.match(sql, /'nl', 'de', 'hysteria2'/);
});

test('VPN confirmation lookup, approval, and rejection stay in the originating conversation', async () => {
  const calls = [];
  const repository = new VpnRepository({ async query(statement, values) {
    calls.push({ statement, values });
    return { rows: [] };
  } });
  const origin = { userId: 'user', originChannel: 'telegram', originDeviceId: null, conversationId: '11111111-1111-4111-8111-111111111111' };
  await repository.latestPending(origin);
  await repository.approve({ ...origin, requestId: '22222222-2222-4222-8222-222222222222' });
  await repository.reject({ ...origin, requestId: '33333333-3333-4333-8333-333333333333' });
  for (const call of calls) {
    assert.match(call.statement, /conversation_id IS NOT DISTINCT FROM/);
    assert.equal(call.values.at(-1), origin.conversationId);
  }
});

test('Telegram update claim uses parameterized SQL', async () => {
  const calls = [];
  const repository = new TelegramUpdateRepository({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [{ update_id: values[0] }] };
    },
  });
  assert.equal(await repository.claim(42, '123', 'message'), true);
  assert.deepEqual(calls[0].values, [42, '123', 'message']);
  assert.equal(calls[0].sql.includes('123'), false);
  await assert.rejects(repository.claim(43, '123', 'unknown'), /invalid Telegram update kind/);
});

test('Telegram update outcomes use parameterized IDs and bounded failure codes', async () => {
  const calls = [];
  const repository = new TelegramUpdateRepository({
    query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 1, rows: [] }; },
  });

  await repository.markCompleted(42);
  await repository.markFailed(43, 'MODEL_UNAVAILABLE');

  assert.match(calls[0].sql, /status='completed'/);
  assert.deepEqual(calls[0].values, [42]);
  assert.match(calls[1].sql, /status='failed'/);
  assert.deepEqual(calls[1].values, [43, 'MODEL_UNAVAILABLE']);
  await assert.rejects(repository.markFailed(44, 'provider secret'), /invalid Telegram failure code/);
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
      if (normalized.includes('ops_maintenance_flags')) return { rowCount: 1, rows: [{ enabled: false }] };
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
  assert.match(calls[1].sql, /ops_maintenance_flags/);
  assert.match(calls[2].sql, /FROM users WHERE id = \$1 FOR UPDATE/);
  assert.match(calls[3].sql, /WHERE user_id = \$1/);
  assert.deepEqual(calls[2].values, ['owner-a']);
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('knowledge worker claim is atomically gated by the maintenance flag', async () => {
  const calls = [];
  const repository = new DocumentRepository({ async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } });
  assert.equal(await repository.claimNextIngest('worker-1'), null);
  assert.match(calls[0].sql, /ops_maintenance_flags/);
  assert.match(calls[0].sql, /knowledge_writes_paused/);
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

test('document delivery lookup binds the document to its owner', async () => {
  const calls = [];
  const repository = new DocumentRepository({ async query(sql, values) { calls.push({ sql: String(sql), values }); return { rows: [] }; } });
  assert.equal(await repository.getActiveForUser({ userId: 'owner-a', documentId: 'doc-a' }), null);
  assert.match(calls[0].sql, /id=\$1 AND user_id=\$2/);
  assert.deepEqual(calls[0].values, ['doc-a', 'owner-a']);
});
