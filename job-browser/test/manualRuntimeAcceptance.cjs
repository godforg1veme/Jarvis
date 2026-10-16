const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const { startBrowser } = require('../src/browserMain');
const { ManualState, initial } = require('../src/manualState');
test('actual headed runtime holds pending mode across restart and rejects read/apply before any operation', { timeout: 30000 }, async () => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'), applyToken = randomBytes(32).toString('hex'), manualToken = randomBytes(32).toString('hex');
  const profile = '/home/pwuser/profile';
  // Only a fresh isolated tmpfs profile is valid for this acceptance.
  assert.deepEqual(await fs.readdir(profile), []);
  await fs.writeFile(profile + '/jarvis-primary-resume.json', JSON.stringify({ id: 'fixtureResume' }), { mode: 0o600, flag: 'wx' });
  const store = new ManualState({ root: profile + '/manual-recovery', ownerId });
  await store.write({ ...initial(ownerId), phase: 'pending', revision: 1, recoveryId: randomUUID(), target: 'https://hh.ru/vacancy/123' });
  const display = spawn('/usr/bin/Xvfb', [':99', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-noreset'], { stdio: 'ignore' });
  let runtime;
  try {
    for (let i = 0; i < 100; i++) {
      if (await fs.stat('/tmp/.X11-unix/X99').catch(() => null)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    process.env.DISPLAY = ':99';
    const env = { JARVIS_JOB_BROWSER_ENABLED: '1', JARVIS_JOB_BROWSER_OWNER_ID: ownerId, JARVIS_JOB_BROWSER_TOKEN: token,
      JARVIS_JOB_BROWSER_APPLY_ENABLED: '1', JARVIS_JOB_BROWSER_APPLY_TOKEN: applyToken,
      JARVIS_JOB_MANUAL_ENABLED: '1', JARVIS_JOB_MANUAL_TOKEN: manualToken };
    runtime = await startBrowser(env);
    assert.equal((await fetch('http://127.0.0.1:8082/status')).status, 403);
    const status = await fetch('http://127.0.0.1:8082/status', { headers: { authorization: `Bearer ${manualToken}`, 'x-jarvis-owner-id': ownerId } });
    assert.deepEqual(await status.json(), { ok: true, value: { phase: 'pending', revision: 1 } });
    for (const [credential, operation, args] of [[token, 'vacancy', { externalId: '123' }], [applyToken, 'submit', {
      operationId: randomUUID(), externalId: '123', resumeId: 'fixtureResume', letter: 'Fixture approved text' }]]) {
      const response = await fetch('http://127.0.0.1:8080/rpc', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ userId: ownerId, operation, args }) });
      assert.deepEqual(await response.json(), { ok: false, code: 'JOB_HH_MANUAL_ACTIVE' });
    }
    await runtime.close(); runtime = null;
    assert.equal((await store.read()).phase, 'pending');
    await assert.rejects(startBrowser({ ...env, JARVIS_JOB_MANUAL_ENABLED: '0' }), { code: 'JOB_HH_MANUAL_ACTIVE' });
  } finally {
    await runtime?.close(); const closed = once(display, 'exit'); display.kill('SIGTERM'); await closed;
  }
});
