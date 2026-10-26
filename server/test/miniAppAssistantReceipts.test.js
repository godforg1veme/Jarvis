const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readReceipt, failReceipt, completeReceipt, responseForReceipt } = require('../src/miniApp/assistantReceipts');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');

const userId = 'user-fixture';
const requestId = '12345678-1234-4234-8234-123456789abc';

function receiptPool({ expired = false, status = 'processing', claimable = false } = {}) {
  let unclaimed = claimable;
  const row = { request_hash: 'a'.repeat(64), status, answer: status === 'completed' ? 'Saved answer' : null,
    failure_code: null, expired };
  const messages = [];
  const query = async (sql, args) => {
    if (/INSERT INTO mini_app_requests/.test(sql)) {
      if (!unclaimed) return { rowCount: 0, rows: [] };
      unclaimed = false; row.request_hash = args[2];
      return { rowCount: 1, rows: [{ request_id: args[1] }] };
    }
    if (/UPDATE mini_app_requests SET status='failed'/.test(sql)) {
      if (row.status === 'processing' && (!sql.includes('AND created_at') || row.expired)) {
        row.status = 'failed'; row.failure_code = row.expired ? 'request_expired' : 'request_failed';
      }
      return { rows: [] };
    }
    if (/SELECT request_hash,status,answer,failure_code/.test(sql)) return { rows: [{ ...row }] };
    if (/SELECT status, created_at/.test(sql)) return { rows: [{ status: row.status, expired: row.expired }] };
    if (/INSERT INTO messages/.test(sql)) { messages.push(args[2]); return { rowCount: 1, rows: [{ id: messages.length }] }; }
    if (/UPDATE mini_app_requests SET status='completed'/.test(sql)) {
      row.status = 'completed'; row.answer = args[2]; return { rowCount: 1, rows: [] };
    }
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    throw Error(`Unexpected fixture query ${sql.slice(0, 60)}`);
  };
  return { row, messages, query, async connect() { return { query, release() {} }; } };
}

test('expired receipt becomes terminal; late worker cannot append its answer', async () => {
  const pool = receiptPool({ expired: true });
  const receipt = await readReceipt(pool, userId, requestId);
  assert.deepEqual(responseForReceipt(receipt), { ok: true, status: 'failed', failureCode: 'request_expired' });
  assert.equal(await completeReceipt(pool, { userId, requestId, conversationId: 'conversation', answer: 'Too late' }), false);
  assert.deepEqual(pool.messages, []);
});

test('known provider error has a terminal receipt and never changes a completed answer', async () => {
  const failed = receiptPool();
  await failReceipt(failed, userId, requestId);
  assert.deepEqual(responseForReceipt(await readReceipt(failed, userId, requestId)),
    { ok: true, status: 'failed', failureCode: 'request_failed' });
  assert.equal(await completeReceipt(failed, { userId, requestId, conversationId: 'conversation', answer: 'Too late' }), false);
  const success = receiptPool();
  assert.equal(await completeReceipt(success, { userId, requestId, conversationId: 'conversation', answer: 'Saved answer' }), true);
  await failReceipt(success, userId, requestId);
  assert.deepEqual(responseForReceipt(await readReceipt(success, userId, requestId)),
    { ok: true, status: 'completed', answer: 'Saved answer' });
  assert.deepEqual(success.messages, ['Saved answer']);
});

test('receipt GET and duplicate POST refuse answer when assistant permission is revoked during lookup', async () => {
  const routes = new Map();
  let permitted = true;
  const pool = receiptPool({ status: 'completed' });
  const body = { requestId, text: 'Fixture question' };
  pool.row.request_hash = createHash('sha256').update(body.text).digest('hex');
  const originalQuery = pool.query;
  pool.query = async (...args) => {
    const result = await originalQuery(...args);
    if (args[0].includes('SELECT request_hash,status,answer,failure_code')) permitted = false;
    return result;
  };
  registerMiniAppSelfRoutes({
    route(method, path, handler) { routes.set(`${method} ${path}`, handler); },
    async authorize() {
      if (!permitted) throw Object.assign(new Error('forbidden'), { code: 'forbidden' });
      return { actor: { userId, permissions: ['assistant'] } };
    },
  }, { pool, accessService: {} });
  await assert.rejects(routes.get('GET /assistant/requests/:id')({ params: { id: requestId } }), { code: 'forbidden' });
  permitted = true;
  await assert.rejects(routes.get('POST /assistant/messages')({ body }), { code: 'forbidden' });
});

test('model failure settles original UUID and a duplicate never calls the model again', async () => {
  const routes = new Map();
  const pool = receiptPool({ claimable: true });
  let modelCalls = 0;
  registerMiniAppSelfRoutes({
    route(method, path, handler) { routes.set(`${method} ${path}`, handler); },
    async authorize() { return { actor: { userId, permissions: ['assistant'] } }; },
  }, {
    pool,
    accessService: {},
    conversationRepository: {
      async getOrCreate() { return { id: 'conversation' }; },
      async appendMessage() {},
      async recentMessages() { return []; },
    },
    assistant: { async answer() { modelCalls++; throw Error('fixture provider failure'); } },
  });
  const post = routes.get('POST /assistant/messages');
  const body = { requestId, text: 'Fixture question' };
  await assert.rejects(post({ body }));
  assert.deepEqual(await routes.get('GET /assistant/requests/:id')({ params: { id: requestId } }),
    { ok: true, status: 'failed', failureCode: 'request_failed' });
  assert.deepEqual(await post({ body }), { ok: true, status: 'failed', failureCode: 'request_failed' });
  assert.equal(modelCalls, 1);
});
