const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { startBrowser } = require('../src/browserMain');
const fs = require('node:fs/promises');

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
  const applyToken = randomBytes(32).toString('hex');
  await assert.rejects(startBrowser({ ...env, JARVIS_JOB_BROWSER_APPLY_ENABLED: '1', JARVIS_JOB_BROWSER_APPLY_TOKEN: token }), /JOB_BROWSER_CONFIG_INVALID/);
  await fs.writeFile('/home/pwuser/profile/jarvis-primary-resume.json', JSON.stringify({ id: 'fixtureResume' }), { flag: 'wx', mode: 0o600 });
  const writer = await startBrowser({ ...env, JARVIS_JOB_BROWSER_APPLY_ENABLED: '1', JARVIS_JOB_BROWSER_APPLY_TOKEN: applyToken });
  try {
    const input = { userId: ownerId, operation: 'reconcile', args: { operationId: randomUUID(), externalId: '123', resumeId: 'fixtureResume', letter: 'Fixture approved text' } };
    const request = (credential) => fetch('http://127.0.0.1:8080/rpc', { method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal((await request(token)).status, 403);
    assert.deepEqual(await (await request(applyToken)).json(), { ok: true, value: { outcome: 'unknown' } });
    assert.equal((await fs.stat('/home/pwuser/profile/applications')).mode & 0o777, 0o700);
  } finally { await writer.close(); }
  await assert.rejects(startBrowser({ ...env, JARVIS_JOB_BROWSER_OWNER_ID: randomUUID() }), /JOB_BROWSER_PROFILE_OWNER_DENIED/);
});
