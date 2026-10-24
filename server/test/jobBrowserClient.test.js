const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { createRpcServer } = require('../../job-browser/src/rpcServer');

test('login frames expose only bounded keyboard geometry and reject arbitrary field data', async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'), connectToken = randomBytes(32).toString('hex');
  const field = { x: 100, y: 200, width: 300, height: 44, type: 'password', inputMode: 'text', multiline: false };
  let frame = { state: 'waiting', mimeType: 'image/jpeg', frameBase64: Buffer.from('fixture-frame').toString('base64'),
    width: 1024, height: 768, inputFields: [field] };
  const client = new JobBrowserClient({ ownerId, token, connectToken,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: frame }), { status: 200 }) }).forUser(ownerId);
  const result = await client.loginFrame({ sessionId: randomUUID() });
  assert.deepEqual(result.inputFields, [field]);
  for (const badFields of [
    [{ ...field, value: 'synthetic-must-not-leave-browser' }],
    [{ ...field, type: 'file' }], [{ ...field, inputMode: 'arbitrary-dom-string' }],
    [{ ...field, multiline: 'true' }], [{ ...field, width: 0 }],
    [{ ...field, x: 1000 }], [{ ...field, y: 760 }],
    [{ ...field, x: -1 }], Array.from({ length: 21 }, () => field), null,
  ]) {
    frame = { ...frame, inputFields: badFields };
    await assert.rejects(client.loginFrame({ sessionId: randomUUID() }), { code: 'JOB_HH_INVALID_RESPONSE' });
  }
  frame = { ...frame, inputFields: [], fieldValues: 'synthetic-private', pageText: 'synthetic-private' };
  const projected = await client.loginFrame({ sessionId: randomUUID() });
  assert.equal(Object.hasOwn(projected, 'fieldValues'), false);
  assert.equal(Object.hasOwn(projected, 'pageText'), false);
  delete frame.inputFields;
  assert.equal(Object.hasOwn(await client.loginFrame({ sessionId: randomUUID() }), 'inputFields'), false);
});

test('collector client uses authenticated owner RPC and propagates closed browser failures', async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'); let calls = 0, missingResume = false;
  const server = createRpcServer({ ownerId, token, browser: {
    async search() { calls++; return { items: [{ id: '123' }], found: 1, pages: 1 }; },
    async getVacancy() { calls++; throw Object.assign(new Error('private'), { code: 'JOB_HH_CAPTCHA_REQUIRED' }); },
    async listResumes() { calls++; return [{ id: 'fixture', title: 'Fixture resume' }]; },
    async inspect({ externalId }) { calls++; if (missingResume) return { vacancy: null, resumeAvailable: false, manualRequired: true };
      return { vacancy: { externalId }, resumeAvailable: true,
      manualRequired: true, reasonCode: 'JOB_HH_RESUME_HIDDEN' }; },
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new JobBrowserClient({ ownerId, token, baseUrl: `http://127.0.0.1:${server.address().port}`, allowTestHttp: true });
    assert.equal(client.forUser(randomUUID()).capabilities.dateWindows, true); assert.equal(calls, 0);
    const bound = client.forUser(ownerId);
    assert.deepEqual(bound.capabilities, { dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 });
    const result = await bound.search({ query: 'AI', publishedFrom: '2026-10-01T12:00:00Z', publishedTo: '2026-10-15T12:00:00Z' });
    assert.equal(result.items[0].id, '123');
    await assert.rejects(bound.getVacancy({ externalId: '123' }), { code: 'JOB_HH_CAPTCHA_REQUIRED' });
    assert.equal((await bound.listResumes()).length, 1);
    assert.equal((await bound.inspect({ externalId: '123', resumeId: 'fixture' })).reasonCode, 'JOB_HH_RESUME_HIDDEN');
    missingResume = true;
    assert.equal((await bound.inspect({ externalId: '123', resumeId: 'fixture' })).resumeAvailable, false);
    assert.equal(calls, 5);
    assert.throws(() => new JobBrowserClient({ ownerId, token, baseUrl: 'http://127.0.0.1:1234' }), { code: 'JOB_BROWSER_CONFIG_INVALID' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('broad HH search metadata reaches collector so it can split before page traversal', async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex');
  let value = { items: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1) })), found: 8953, pages: 448 };
  const client = new JobBrowserClient({ ownerId, token,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, value }), { status: 200 }) }).forUser(ownerId);
  assert.equal((await client.search({ query: 'AI', publishedFrom: '2026-10-20T00:00:00Z', publishedTo: '2026-10-21T00:00:00Z' })).pages, 448);
  value = { ...value, found: 1000000, pages: 50000 };
  assert.equal((await client.search({ query: 'AI', publishedFrom: '2026-10-20T00:00:00Z', publishedTo: '2026-10-21T00:00:00Z' })).pages, 50000);
  value = { ...value, pages: 50001 };
  await assert.rejects(client.search({ query: 'AI', publishedFrom: '2026-10-20T00:00:00Z', publishedTo: '2026-10-21T00:00:00Z' }),
    { code: 'JOB_HH_INVALID_RESPONSE' });
});

test('application adapter uses the isolated write credential and preserves original approved text during recovery', async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'), applyToken = randomBytes(32).toString('hex');
  const args = { operationId: randomUUID(), externalId: '123', resumeId: 'fixture', letter: 'Точный текст\nбез замены' };
  let submits = 0, reconciles = 0, outcome = { outcome: 'unknown' };
  const server = createRpcServer({ ownerId, token, applyToken, browser: {}, submissions: {
    async submit(input) { assert.deepEqual(input, { userId: ownerId, ...args }); submits++; return outcome; },
    async reconcile(input) { assert.deepEqual(input, { userId: ownerId, ...args }); reconciles++;
      return { outcome: 'sent', verified: true, externalId: '98765' }; },
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const options = { ownerId, token, baseUrl: `http://127.0.0.1:${server.address().port}`, allowTestHttp: true };
    const readOnly = new JobBrowserClient(options).asApplicationAdapter();
    assert.equal(readOnly.capabilities.applicantApply, false);
    await assert.rejects(readOnly.submit({ userId: ownerId, ...args }), { code: 'JOB_BROWSER_ACCESS_DENIED' });
    const adapter = new JobBrowserClient({ ...options, applyToken }).asApplicationAdapter();
    await assert.rejects(adapter.submit({ userId: randomUUID(), ...args }), { code: 'JOB_BROWSER_ACCESS_DENIED' });
    assert.equal(submits, 0);
    assert.equal((await adapter.submit({ userId: ownerId, ...args })).outcome, 'unknown');
    assert.equal(submits, 1);
    assert.deepEqual(await adapter.reconcile({ userId: ownerId, ...args }), { outcome: 'sent', verified: true, externalId: '98765' });
    assert.equal(submits, 1); assert.equal(reconciles, 1);
    outcome = { outcome: 'sent', externalId: '98765' };
    await assert.rejects(adapter.submit({ userId: ownerId, ...args }), { code: 'JOB_HH_INVALID_RESPONSE' });
    assert.throws(() => new JobBrowserClient({ ...options, applyToken: token }), { code: 'JOB_BROWSER_CONFIG_INVALID' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
