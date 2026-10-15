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
