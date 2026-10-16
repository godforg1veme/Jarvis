const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const { CaptchaRecovery } = require('../src/captchaRecovery');
const { startBrowser } = require('../src/browserMain');
test('fresh actual runtime emits first human picture immediately with OCR flag present and never calls OCR', { timeout: 30000 }, async t => {
  assert.deepEqual(await fs.readdir('/home/pwuser/profile'), []);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-human-runtime-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, 'key'), '-out', path.join(root, 'cert'), '-subj', '/CN=hh.ru', '-days', '1'], { stdio: 'ignore' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=', 'base64');
  let posts = 0, inits = 0, ocrBegins = 0;
  const fixture = https.createServer({ key: await fs.readFile(path.join(root, 'key')), cert: await fs.readFile(path.join(root, 'cert')) }, (req, res) => {
    const u = new URL(req.url, 'https://hh.ru');
    if (req.method === 'POST') {
      if (u.pathname === '/captcha') { inits++; res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"key":"first-human-picture"}'); }
      posts++; res.writeHead(403); return res.end();
    }
    if (u.pathname === '/vacancy/123') { res.writeHead(302, { location: '/account/captcha?backurl=%2Fvacancy%2F123&state=fixture' }); return res.end(); }
    if (u.pathname === '/captcha/picture') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>Подтвердите, что вы не робот</h1><img id="picture" style="width:240px;height:70px"><form method="post" action="${u.href.replace(/&/g, '&amp;')}"><input type="hidden" name="_xsrf" value="fixture-xsrf"><input name="captchaText"><input type="hidden" name="isBot" value="false"><button>Go</button></form><script>fetch('/captcha?lang=RU',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}}).then(r=>r.json()).then(v=>picture.src='/captcha/picture?key='+v.key).catch(()=>{});</script>`);
  });
  await new Promise(resolve => fixture.listen(443, '127.0.0.1', resolve));
  const launch = chromium.launchPersistentContext.bind(chromium);
  // The local fixture certificate exception is injected only by this test;
  // production startBrowser keeps its original TLS checks and sandbox flags.
  t.mock.method(chromium, 'launchPersistentContext', (root, options) => { assert.equal(options.headless, true); assert.equal(options.chromiumSandbox, true); return launch(root, { ...options, ignoreHTTPSErrors: true }); });
  t.mock.method(CaptchaRecovery.prototype, 'begin', () => { ocrBegins++; throw new Error('OCR_MUST_NOT_RUN'); });
  const ownerId = randomUUID(), token = randomBytes(32).toString('hex'), captchaToken = randomBytes(32).toString('hex');
  let runtime;
  try {
    runtime = await startBrowser({ JARVIS_JOB_BROWSER_ENABLED: '1', JARVIS_JOB_BROWSER_OWNER_ID: ownerId, JARVIS_JOB_BROWSER_TOKEN: token,
      JARVIS_HH_CAPTCHA_RECOVERY: '1', JARVIS_HH_CAPTCHA_TELEGRAM: '1', JARVIS_JOB_CAPTCHA_TOKEN: captchaToken });
    const result = await fetch('http://127.0.0.1:8080/rpc', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ userId: ownerId, operation: 'vacancy', args: { externalId: '123' } }) });
    assert.equal((await result.json()).code, 'JOB_HH_CAPTCHA_MANUAL_REQUIRED');
    const snapshot = await fetch('http://127.0.0.1:8082/rpc', { method: 'POST', headers: { authorization: `Bearer ${captchaToken}`, 'x-jarvis-owner-id': ownerId, 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'challenge', args: { refresh: false } }) });
    const payload = await snapshot.json(); assert.equal(payload.ok, true); assert.equal(payload.value.outcome, 'ready');
    assert.equal(ocrBegins, 0); assert.equal(posts, 0); assert.equal(inits, 1);
    const state = JSON.parse(await fs.readFile('/home/pwuser/profile/manual-recovery/state.json', 'utf8'));
    assert.equal(state.phase, 'active'); assert.equal(state.seedRequired, false); assert.equal(state.claims.length, 0);
  } finally { await runtime?.close(); await new Promise(resolve => fixture.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});
