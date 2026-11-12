const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { createDeviceToken, deviceTokenHash } = require('../src/devices/deviceCredentials');
const { registerDesktopWorkspaceRoutes, actionSessionVerifier } = require('../src/desktop/workspaceRoutes');

const userId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';

function setup(job = null) {
  const token = createDeviceToken();
  let active = true;
  let permissions = ['assistant', 'memory', 'documents', 'jobs'];
  const memoryOps = new Map();
  let memoryWrites = 0;
  const actor = () => ({ userId, telegramId: '101', level: 'member', permissions, blocked: false });
  const db = { async query(sql, args) {
    if (sql.includes('FROM devices')) return { rowCount: active && args[0] === deviceId
      && args[1] === userId && args[2].equals(deviceTokenHash(token)) ? 1 : 0 };
    if (sql.includes('FROM mini_app_memory_operations')) {
      const row = memoryOps.get(args[1]); return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO mini_app_memory_operations')) {
      if (memoryOps.has(args[1])) return { rows: [], rowCount: 0 };
      const row = sql.includes("'cancelled'") ? { status: 'cancelled', memory_id: null }
        : { status: 'completed', request_hash: args[2], memory_id: args[4] };
      memoryOps.set(args[1], row); return { rows: [row], rowCount: 1 };
    }
    throw new Error('unexpected query');
  } };
  const accessService = {
    async getAccessForUser(id) { return id === userId ? actor() : null; },
    repository: { async get(_db, field, id) { return field === 'user' && id === userId ? actor() : null; } },
    transaction: (fn) => fn(db),
  };
  const calls = [];
  const app = Fastify({ logger: false });
  registerDesktopWorkspaceRoutes(app, {
    authenticate: async (headers) => {
      if (!active || headers.authorization !== `Bearer ${token}`) {
        const error = new Error('credential rejected'); error.publicCode = 'DEVICE_AUTH_REQUIRED'; throw error;
      }
      return { id: deviceId, user_id: userId };
    },
    accessService, sectionReader: { async read(input) { calls.push(input); return input.section === 'assistant'
      ? { messages: [{ id: '1', role: 'assistant', content: 'fixture' }], paging: { nextCursor: null } }
      : { items: [{ id: deviceId, title: 'fixture' }], paging: { nextCursor: null } }; } },
    conversationRepository: { async getOrCreate(input) { calls.push(input); return { id: deviceId }; } },
    memoryService: { async list() { return []; } },
    memoryActionService: { async remember() { memoryWrites++; return { ok: true,
      memory: { id: '33333333-3333-4333-8333-333333333333' } }; } },
    personalActionSections: { documents: { kinds: ['delete'], async describe() { return { items: [] }; } } },
    ...(job ? {
      pool: { async query(sql, args) {
        assert.match(sql, /FROM job_resume_operations/);
        assert.equal(args[0], userId);
        assert.equal(args[1], job.requestId);
        job.lookups = (job.lookups || 0) + 1;
        if (job.dbFailure) throw new Error('database unavailable');
        return { rowCount: job.ledgerExists ? 1 : 0 };
      } },
      getJobResumeService: () => ({
        async refresh() { job.onRequest?.(); throw Object.assign(new Error('fixture rejection'), { code: job.errorCode }); },
        async settings() { job.onRequest?.(); throw Object.assign(new Error('fixture rejection'), { code: job.errorCode }); },
      }),
    } : {}),
  });
  const request = (method, path, payload, headers = {}) => app.inject({ method, url: `/v1/desktop/workspace${path}`,
    headers: { authorization: `Bearer ${token}`, ...headers }, ...(payload === undefined ? {} : { payload }) });
  return { app, db, token, request, calls, memoryWrites: () => memoryWrites, setActive(value) { active = value; },
    setPermissions(value) { permissions = value; } };
}

test('workspace enforces device auth, current rights and a closed route list', async () => {
  const f = setup();
  try {
    assert.equal((await f.request('GET', '/me')).json().actor.telegramId, '101');
    assert.equal((await f.request('GET', '/sections/memory')).json().items[0].title, 'fixture');
    assert.equal((await f.request('GET', '/sections/memory', undefined, { authorization: '' })).statusCode, 401);
    assert.equal((await f.request('GET', '/sections/memory?unexpected=1')).statusCode, 400);
    f.setPermissions(['assistant']);
    assert.equal((await f.request('GET', '/sections/memory')).statusCode, 403);
    assert.equal((await f.request('GET', '/sections/documents/actions')).statusCode, 403);
    f.setActive(false);
    assert.equal((await f.request('GET', '/me')).statusCode, 401);
    assert.equal((await f.request('GET', '/assistant/messages')).statusCode, 401);
    assert.equal((await f.request('POST', '/assistant/messages', { text: 'forbidden' })).statusCode, 404);
    assert.equal((await f.request('POST', '/jobs/login/claim', { ticket: 'ignored' })).statusCode, 404);
    assert.equal((await f.request('GET', '/admin')).statusCode, 404);
  } finally { await f.app.close(); }
});

test('resume preclaim rejection proves absent original ledger before exposing notStarted', async () => {
  const job = { requestId: '66666666-6666-4666-8666-666666666666',
    errorCode: 'JOB_HH_NOT_CONNECTED', ledgerExists: false };
  const f = setup(job);
  try {
    for (const path of ['/jobs/resumes/refresh', '/jobs/resumes/settings']) {
      const response = await f.request('POST', path, { requestId: job.requestId });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().notStarted, true);
    }
    assert.equal(job.lookups, 2);
    job.ledgerExists = true;
    const existing = await f.request('POST', '/jobs/resumes/refresh', { requestId: job.requestId });
    assert.equal(existing.json().notStarted, undefined);
    job.ledgerExists = false; job.dbFailure = true;
    const unknown = await f.request('POST', '/jobs/resumes/refresh', { requestId: job.requestId });
    assert.equal(unknown.json().notStarted, undefined);
    job.dbFailure = false; job.onRequest = () => f.setPermissions([]);
    const revoked = await f.request('POST', '/jobs/resumes/refresh', { requestId: job.requestId });
    assert.equal(revoked.json().notStarted, undefined);
    job.onRequest = null; f.setPermissions(['jobs']);
    const malformed = await f.request('POST', '/jobs/resumes/refresh', { requestId: 'bad' });
    assert.equal(malformed.json().notStarted, undefined);
  } finally { await f.app.close(); }
});

test('memory mutation uses one receipt across duplicate requests and refuses revoked device', async () => {
  const f = setup();
  const operationId = '44444444-4444-4444-8444-444444444444';
  const command = { operationId, kind: 'add', memoryId: null, expectedDigest: null, content: 'fixture memory' };
  try {
    const first = await f.request('POST', '/memory/operations', command);
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().status, 'completed');
    const duplicate = await f.request('POST', '/memory/operations', command);
    assert.equal(duplicate.statusCode, 200);
    assert.equal(f.memoryWrites(), 1);
    assert.equal((await f.request('GET', `/memory/operations/${operationId}`)).json().status, 'completed');
    assert.equal((await f.request('POST', '/memory/operations', { ...command, content: 'different' })).statusCode, 409);
    f.setActive(false);
    assert.equal((await f.request('GET', `/memory/operations/${operationId}`)).statusCode, 401);
    assert.equal((await f.request('POST', '/memory/operations', command)).statusCode, 401);
    assert.equal(f.memoryWrites(), 1);
  } finally { await f.app.close(); }
});

test('desktop history is scoped to its device conversation and Mini history remains distinct', async () => {
  const f = setup();
  try {
    const response = await f.request('GET', '/desktop/messages');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().messages, [{ id: '1', role: 'assistant', content: 'fixture' }]);
    assert(f.calls.some((input) => input.channel === 'desktop' && input.externalChatId === deviceId && input.userId === userId));
    const mini = await f.request('GET', '/assistant/messages');
    assert.equal(mini.statusCode, 200);
    assert(f.calls.some((input) => input.channel === 'pwa' && input.externalChatId === 'mini'));
    f.setPermissions([]);
    assert.equal((await f.request('GET', '/desktop/messages')).statusCode, 403);
  } finally { await f.app.close(); }
});

test('upload checks device and documents permission before buffering bytes', async () => {
  const f = setup();
  const operationId = '55555555-5555-4555-8555-555555555555';
  const headers = { 'content-type': 'application/octet-stream',
    'x-jarvis-file-name': 'fixture.txt', 'x-jarvis-file-type': 'text/plain' };
  try {
    const path = `/sections/documents/uploads/${operationId}`;
    assert.equal((await f.request('POST', path, Buffer.alloc(32),
      { ...headers, authorization: '' })).statusCode, 401);
    f.setPermissions(['assistant']);
    assert.equal((await f.request('POST', path, Buffer.alloc(32), headers)).statusCode, 403);
    f.setPermissions(['documents']);
    assert.equal((await f.request('POST', path, Buffer.alloc(32), headers)).statusCode, 400);
  } finally { await f.app.close(); }
});

test('personal action transaction checks current device credential and member permission', async () => {
  const f = setup();
  try {
    const first = await f.request('GET', '/sections/documents/actions');
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json().kinds, ['delete']);
    const hash = deviceTokenHash(f.token);
    const session = { actor: { userId }, deviceId, deviceTokenHash: hash };
    assert.match(await actionSessionVerifier(f.db, session, { userId }), /^[a-f0-9]{64}$/);
    await assert.rejects(actionSessionVerifier(f.db, { ...session, deviceId: 'other' }, { userId }), { code: 'unauthorized' });
    assert.throws(() => actionSessionVerifier(f.db, session,
      { userId: '33333333-3333-4333-8333-333333333333' }), { code: 'unauthorized' });
    f.setActive(false);
    await assert.rejects(actionSessionVerifier(f.db, session, { userId }), { code: 'unauthorized' });
  } finally { await f.app.close(); }
});
