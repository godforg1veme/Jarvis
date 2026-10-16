const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { startBrowser } = require('../src/browserMain');
const { ManualState, initial } = require('../src/manualState');
test('actual headless Telegram runtime preserves pending, authenticates separate broker and blocks read/apply', { timeout: 30000 }, async t => {
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'), applyToken = randomBytes(32).toString('hex'), manualToken = randomBytes(32).toString('hex');
  const profile = '/home/pwuser/profile';
  // Only a fresh isolated tmpfs profile is valid for this acceptance.
  assert.deepEqual(await fs.readdir(profile), []);
  await fs.writeFile(profile + '/jarvis-primary-resume.json', JSON.stringify({ id: 'fixtureResume' }), { mode: 0o600, flag: 'wx' });
  const store = new ManualState({ root: profile + '/manual-recovery', ownerId });
  await store.write({ ...initial(ownerId), phase: 'pending', revision: 1, recoveryId: randomUUID(), target: 'https://hh.ru/vacancy/123' });
  let runtime;
  const { chromium } = require('playwright'); let context, fatals=0;
  const launch = chromium.launchPersistentContext.bind(chromium);
  t.mock.method(chromium,'launchPersistentContext',async (...args)=>{context=await launch(...args);return context;});
  try {
    const env = { JARVIS_JOB_BROWSER_ENABLED: '1', JARVIS_JOB_BROWSER_OWNER_ID: ownerId, JARVIS_JOB_BROWSER_TOKEN: token,
      JARVIS_JOB_BROWSER_APPLY_ENABLED: '1', JARVIS_JOB_BROWSER_APPLY_TOKEN: applyToken,
      JARVIS_HH_CAPTCHA_TELEGRAM: '1', JARVIS_JOB_CAPTCHA_TOKEN: manualToken };
    runtime = await startBrowser(env,{onFatal:()=>fatals++});
    const options = credential => ({ method: 'POST', headers: { authorization: `Bearer ${credential}`, 'x-jarvis-owner-id': ownerId, 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'status', args: {} }) });
    assert.equal((await fetch('http://127.0.0.1:8082/rpc', options(token))).status, 403);
    assert.equal((await fetch('http://127.0.0.1:8082/rpc', options(applyToken))).status, 403);
    const status = await fetch('http://127.0.0.1:8082/rpc', options(manualToken));
    assert.deepEqual(await status.json(), { ok: true, value: { phase: 'pending', revision: 1 } });
    for (const [credential, operation, args] of [[token, 'vacancy', { externalId: '123' }], [applyToken, 'submit', {
      operationId: randomUUID(), externalId: '123', resumeId: 'fixtureResume', letter: 'Fixture approved text' }]]) {
      const response = await fetch('http://127.0.0.1:8080/rpc', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ userId: ownerId, operation, args }) });
      assert.deepEqual(await response.json(), { ok: false, code: 'JOB_HH_MANUAL_ACTIVE' });
    }
    await context.close(); assert.equal(fatals,1);
    const failedHealth=await fetch('http://127.0.0.1:8080/health',{headers:{authorization:`Bearer ${token}`}});
    assert.equal(failedHealth.status,503);
    await runtime.close(); runtime = null; assert.equal(fatals,1);
    assert.equal((await store.read()).phase, 'pending');
    await assert.rejects(startBrowser({ ...env, JARVIS_HH_CAPTCHA_TELEGRAM: '0' }), { code: 'JOB_HH_MANUAL_ACTIVE' });
    await assert.rejects(startBrowser({ ...env, JARVIS_JOB_CAPTCHA_TOKEN: token }), /JOB_MANUAL_CONFIG_INVALID/);
    const tcp = await fs.readFile('/proc/net/tcp', 'utf8');
    assert.equal(/:170C\s/.test(tcp), false); assert.equal(/:17D3\s/.test(tcp), false);
  } finally {
    await runtime?.close();
  }
});
