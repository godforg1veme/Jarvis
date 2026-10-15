const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { createRpcServer } = require('../../job-browser/src/rpcServer');

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
    assert.throws(() => client.forUser(randomUUID()), { code: 'JOB_BROWSER_ACCESS_DENIED' }); assert.equal(calls, 0);
    const bound = client.forUser(ownerId);
    assert.equal(bound.capabilities.dateWindows, false);
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
