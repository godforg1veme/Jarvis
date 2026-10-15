const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { createRpcServer } = require('../../job-browser/src/rpcServer');

test('collector client uses authenticated owner RPC and propagates closed browser failures', async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'); let calls = 0;
  const server = createRpcServer({ ownerId, token, browser: {
    async search() { calls++; return { items: [{ id: '123' }], found: 1, pages: 1 }; },
    async getVacancy() { calls++; throw Object.assign(new Error('private'), { code: 'JOB_HH_CAPTCHA_REQUIRED' }); },
    async listResumes() { calls++; return [{ id: 'fixture', title: 'Fixture resume' }]; },
    async inspect({ externalId }) { calls++; return { vacancy: { externalId }, resumeAvailable: true,
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
    assert.equal(calls, 4);
    assert.throws(() => new JobBrowserClient({ ownerId, token, baseUrl: 'http://127.0.0.1:1234' }), { code: 'JOB_BROWSER_CONFIG_INVALID' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
