const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { startBrowser } = require('../src/browserMain');

test('private runtime starts with Chromium sandbox, authenticates health and refuses profile owner changes', async () => {
  // Run only with a fresh private tmpfs at /home/pwuser/profile; never with an owner's profile.
  const token = randomBytes(32).toString('hex'), ownerId = randomUUID();
  const env = { JARVIS_JOB_BROWSER_ENABLED: '1', JARVIS_JOB_BROWSER_OWNER_ID: ownerId, JARVIS_JOB_BROWSER_TOKEN: token };
  const runtime = await startBrowser(env);
  try {
    const health = await fetch('http://127.0.0.1:8080/health', { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal((await fetch('http://127.0.0.1:8080/health')).status, 401);
    const foreign = await fetch('http://127.0.0.1:8080/rpc', { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ userId: randomUUID(), operation: 'resumes', args: {} }) });
    assert.equal(foreign.status, 403);
  } finally { await runtime.close(); }
  await assert.rejects(startBrowser({ ...env, JARVIS_JOB_BROWSER_OWNER_ID: randomUUID() }), /JOB_BROWSER_PROFILE_OWNER_DENIED/);
});
