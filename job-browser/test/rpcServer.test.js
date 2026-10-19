const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createRpcServer } = require('../src/rpcServer');

test('real RPC transport rejects foreign actors, bad auth, extra keys and oversized bodies before browser access', async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'); let calls = 0;
  const server = createRpcServer({ ownerId, token, browser: {
    async search() { calls++; return { items: [{ id: '123' }], found: 1, pages: 1 }; },
    async getVacancy() { calls++; throw Object.assign(new Error('private data must not leak'), { code: 'UNTRUSTED' }); },
    async listResumes() { calls++; return []; },
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/rpc`;
  const request = (input, credential = token) => fetch(url, { method: 'POST', headers: {
    authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: typeof input === 'string' ? input : JSON.stringify(input) });
  const input = { userId: ownerId, operation: 'search', args: { query: 'AI',
    publishedFrom: '2026-10-01T12:00:00Z', publishedTo: '2026-10-15T12:00:00Z', page: 0 } };
  try {
    assert.equal((await request(input, 'wrong')).status, 401);
    assert.equal((await request({ ...input, userId: randomUUID() })).status, 403);
    assert.equal((await request({ ...input, shell: 'forbidden' })).status, 403);
    assert.equal((await request({ ...input, operation: 'submit' })).status, 403);
    assert.equal((await request({ ...input, args: { ...input.args, url: 'http://127.0.0.1/' } })).status, 403);
    assert.equal((await request('x'.repeat(8193))).status, 413);
    assert.equal(calls, 0);
    assert.deepEqual(await (await request(input)).json(), { ok: true, value: { items: [{ id: '123' }], found: 1, pages: 1 } });
    const failed = await request({ userId: ownerId, operation: 'vacancy', args: { externalId: '123' } });
    assert.deepEqual(await failed.json(), { ok: false, code: 'JOB_HH_UNAVAILABLE' });
    assert.equal(calls, 2);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('write RPC needs a distinct credential, exact owner/operation and bounded approved text', async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'), applyToken = randomBytes(32).toString('hex'); let writes = 0;
  const server = createRpcServer({ ownerId, token, applyToken, browser: {}, submissions: {
    async submit() { writes++; return { outcome: 'unknown' }; }, async reconcile() { return { outcome: 'unknown' }; },
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/rpc`;
  const input = { userId: ownerId, operation: 'submit', args: { operationId: randomUUID(), externalId: '123', resumeId: 'fixture', letter: 'Я'.repeat(10000) } };
  const request = (value, credential) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(value) });
  try {
    assert.equal((await request({ ...input, args: { ...input.args, letter: 'Fixture' } }, token)).status, 403);
    assert.equal((await request(input, token)).status, 413);
    assert.equal((await request({ ...input, userId: randomUUID() }, applyToken)).status, 403);
    assert.equal((await request({ ...input, args: { ...input.args, operationId: 'invalid' } }, applyToken)).status, 403);
    assert.equal((await request({ ...input, args: { ...input.args, arbitraryUrl: 'https://hh.ru' } }, applyToken)).status, 403);
    assert.equal(writes, 0);
    assert.deepEqual(await (await request(input, applyToken)).json(), { ok: true, value: { outcome: 'unknown' } });
    assert.equal(writes, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  assert.throws(() => createRpcServer({ ownerId, token, applyToken: token, browser: {}, submissions: {} }), /JOB_BROWSER_CONFIG_INVALID/);
});

test('member profiles use isolated user routing and login RPC requires the connect credential', async () => {
  const ownerId = randomUUID(), memberA = randomUUID(), memberB = randomUUID();
  const token = randomBytes(32).toString('hex'), connectToken = randomBytes(32).toString('hex');
  const calls = [], profiles = new Map();
  const manager = {
    forUser(userId) {
      calls.push(['profile', userId]);
      if (!profiles.has(userId)) profiles.set(userId, { browser: {
        async search() { return { items: [{ id: userId === memberA ? '101' : '202' }], found: 1, pages: 1 }; },
        async startLogin({ sessionId }) { calls.push(['login_start', userId, sessionId]); return { ok: true }; },
        async loginFrame({ sessionId }) { calls.push(['login_frame', userId, sessionId]); return { state: 'waiting', mimeType: 'image/jpeg', frameBase64: 'ZmFrZQ==', width: 1024, height: 768 }; },
        async loginInput({ sessionId, sequence, event }) { calls.push(['login_input', userId, sessionId, sequence, event.type]); return { state: 'waiting', nextSequence: sequence + 1 }; },
        async loginStatus({ sessionId }) { return { state: 'waiting', resumes: [], nextSequence: 1, sessionId }; },
      } });
      return profiles.get(userId);
    },
    async discardUnconfirmedUser(userId, sessionId) { calls.push(['discard', userId, sessionId]); return { ok: true }; },
  };
  const server = createRpcServer({ ownerId, token, connectToken, profiles: manager, browser: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/rpc`;
  const request = (input, credential) => fetch(url, { method: 'POST', headers: {
    authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const sessionId = randomUUID();
  try {
    const start = { userId: memberA, operation: 'login_start', args: { sessionId } };
    assert.equal((await request(start, token)).status, 403);
    assert.deepEqual(await (await request(start, connectToken)).json(), { ok: true, value: { ok: true } });
    const frame = await request({ userId: memberA, operation: 'login_frame', args: { sessionId } }, connectToken);
    assert.equal(frame.status, 200);
    assert.equal((await frame.json()).value.width, 1024);
    const input = { userId: memberA, operation: 'login_input', args: {
      sessionId, sequence: 2, event: { type: 'text', value: 'fixture only' },
    } };
    assert.equal((await request({ ...input, args: { ...input.args, url: 'https://attacker.example' } }, connectToken)).status, 403);
    assert.equal((await request(input, token)).status, 403);
    assert.deepEqual(await (await request(input, connectToken)).json(), { ok: true, value: { state: 'waiting', nextSequence: 3 } });

    const search = (userId) => ({ userId, operation: 'search', args: { query: 'Fixture',
      publishedFrom: '2026-10-01T00:00:00Z', publishedTo: '2026-10-15T00:00:00Z', page: 0 } });
    assert.equal((await request(search(memberA), connectToken)).status, 403);
    const a = await (await request(search(memberA), token)).json();
    const b = await (await request(search(memberB), token)).json();
    assert.equal(a.value.items[0].id, '101');
    assert.equal(b.value.items[0].id, '202');
    assert.equal(calls.some(([, userId]) => userId === memberA), true);
    assert.equal(calls.some(([, userId]) => userId === memberB), true);
    assert.equal(calls.some(([, userId]) => userId === ownerId), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
