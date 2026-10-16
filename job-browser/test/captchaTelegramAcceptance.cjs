const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { ManualState } = require('../src/manualState');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { CaptchaTelegramBrowser, validPng, hashKey } = require('../src/captchaTelegramBrowser');
const { CaptchaJournal } = require('../src/captchaJournal');
const { HhBrowser } = require('../src/hhBrowser');
const { allowedRequest } = require('../src/networkPolicy');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=', 'base64');
test('real HTTPS human CAPTCHA: image-only cache, stale/expiry, exactly-once native POST, unknown/restart, exact read', { timeout: 120000 }, async () => {
  // Isolated container --network none --add-host hh.ru:127.0.0.1 only.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-telegram-')); await fs.chmod(root, 0o700);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, 'key'), '-out', path.join(root, 'cert'), '-subj', '/CN=hh.ru', '-days', '1'], { stdio: 'ignore' });
  const ownerId = randomUUID(), recoveryId = randomUUID(), target = 'https://hh.ru/vacancy/123';
  let now = 2000000000000, keyNumber = 0, posts = 0, inits = 0, forbidden = 0, gets = 0, mode = 'reject', solved = false, controller;
  const server = https.createServer({ key: await fs.readFile(path.join(root, 'key')), cert: await fs.readFile(path.join(root, 'cert')) }, async (req, res) => {
    const url = new URL(req.url, 'https://hh.ru');
    if (req.method === 'POST' && url.pathname === '/captcha') {
      inits++; keyNumber++; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ key: `picture-${keyNumber}` }));
    }
    if (req.method === 'POST' && url.pathname === '/account/captcha') {
      posts++;
      assert.equal(url.searchParams.get('captchaText'), 'проверка картинки');
      if (mode === 'unknown') return req.socket.destroy();
      if (mode === 'redirect') { res.writeHead(307, { location: 'https://hh.ru/forbidden' }); return res.end(); }
      if (mode === 'success') { solved = true; res.setHeader('set-cookie', 'fixture_solved=yes; Path=/; Secure; HttpOnly'); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}');
    }
    if (req.method === 'POST') { forbidden++; res.writeHead(403); return res.end(); }
    if (url.pathname === '/captcha/picture') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png); }
    if (url.pathname === '/vacancy/123' || url.pathname === '/vacancy/124') {
      gets++;
      if (mode === 'wrong-target' && url.pathname === '/vacancy/123') { res.writeHead(302, { location: '/vacancy/124' }); return res.end(); }
      if (solved || mode === 'wrong-target') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<script type="application/ld+json">{"@type":"JobPosting","title":"Fixture","datePosted":"2026-10-16T00:00:00+03:00","hiringOrganization":{"name":"Fixture"}}</script><div data-qa="vacancy-description">Fixture</div>');
      }
      res.writeHead(302, { location: '/account/captcha?backurl=%2Fvacancy%2F123&state=fixture' }); return res.end();
    }
    if (url.pathname === '/account/captcha') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<h1>Подтвердите, что вы не робот</h1><div id="account">PRIVATE PAGE CONTENT MUST NOT BE IN PNG</div>
        <img id="picture" alt="captcha" src="" style="display:block;width:240px;height:70px">
        <form action="${url.href.replace(/&/g, '&amp;')}" method="post"><input type="hidden" name="_xsrf" value="fixture-xsrf"><input name="captchaText"><input type="hidden" name="isBot" value="false"><button type="submit">Продолжить</button></form>
        <script>fetch('/captcha?lang=RU',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}}).then(r=>r.json()).then(v=>picture.src='/captcha/picture?key='+v.key).catch(()=>{});
        document.querySelector('form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,a=new URL(f.action),k=new URL(picture.src).searchParams.get('key');
        const q=new URLSearchParams({captchaText:f.elements.captchaText.value,captchaKey:k,captchaState:a.searchParams.get('state'),backurl:a.searchParams.get('backurl'),failurl:f.action});
        const send=()=>{const x=new XMLHttpRequest();x.open('POST','/account/captcha?'+q);x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');x.setRequestHeader('X-Xsrftoken',f.elements._xsrf.value);x.send();};send();send();};</script>`);
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(443, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const req = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return allowedRequest(req.url()) ? route.continue() : route.abort();
    try { if (controller && await controller.permit(route)) return; } catch {}
    return route.abort();
  });
  const store = new ManualState({ root: path.join(root, 'manual'), ownerId });
  const journal = new CaptchaJournal({ root: path.join(root, 'journal'), ownerId });
  await journal.write({ version: 1, ownerId, operationId: recoveryId, phase: 'blocked', detectedAt: now, retryAt: now + 120000, targetHash: createHash('sha256').update(target).digest('hex') });
  let coordinator;
  function restart() {
    coordinator = new ManualCoordinator({ store, open: u => controller.open(u), verify: (u, id) => controller.verify(u, id) });
    controller = new CaptchaTelegramBrowser({ context, coordinator, journal, now: () => now, receiptTimeout: 1000 });
  }
  const answer = (challenge, extra = {}) => controller.answer({ challengeId: challenge.challengeId, revision: challenge.revision, operationId: randomUUID(), text: '  ПРОВЕРКА   Картинки  ', ...extra });
  try {
    restart(); await coordinator.load(); await coordinator.pending({ target, recoveryId });
    const hh = new HhBrowser({ context, manualCoordinator: coordinator });
    await assert.rejects(hh.getVacancy({ externalId: '123' }), { code: 'JOB_HH_MANUAL_ACTIVE' }); assert.equal(gets, 0);
    const first = await controller.challenge(false); assert.equal(first.outcome, 'ready');
    const bytes = Buffer.from(first.pngBase64, 'base64'); assert.equal(validPng(bytes), true);
    // Native image is1x1 but displayed240x70. Exported PNG must contain only
    // the native decoded pixels, never surrounding page/CSS/account content.
    assert.equal(bytes.readUInt32BE(16), 1); assert.equal(bytes.readUInt32BE(20), 1);
    assert.deepEqual(Object.keys(first).sort(), ['challengeId', 'expiresAt', 'outcome', 'pngBase64', 'revision']);
    const initializations = inits; assert.deepEqual(await controller.challenge(false), first); assert.equal(inits, initializations);
    assert.deepEqual(await answer(first, { text: 'invalid' }), { outcome: 'invalid' }); assert.equal((await store.read()).claims.length, 0);
    const replaced = await controller.challenge(true); assert.notEqual(replaced.challengeId, first.challengeId);
    assert.deepEqual(await answer(first), { outcome: 'stale' }); assert.equal(posts, 0);
    now += 600001; assert.deepEqual(await answer(replaced), { outcome: 'stale' }); assert.equal(posts, 0);
    const rejected = await controller.challenge(true), operationId = randomUUID(), pagesBefore = context.pages().length;
    assert.deepEqual(await answer(rejected, { operationId }), { outcome: 'new_challenge' });
    assert.equal(posts, 1); assert.equal(context.pages().length, pagesBefore); assert.equal(coordinator.status().phase, 'active');
    assert.deepEqual(await answer(rejected, { operationId }), { outcome: 'already_used' }); assert.equal(posts, 1);
    await assert.rejects(controller.challenge(false), { code: 'JOB_CAPTCHA_UNAVAILABLE' });
    const savedClaims = (await store.read()).claims; assert.equal(savedClaims.length, 2);
    await controller.close(); restart(); await coordinator.load();
    assert.deepEqual((await store.read()).claims, savedClaims);
    assert.deepEqual(await answer(rejected, { operationId }), { outcome: 'already_used' }); assert.equal(posts, 1);
    mode = 'unknown'; const unknown = await controller.challenge(true), unknownOperation = randomUUID();
    assert.deepEqual(await answer(unknown, { operationId: unknownOperation }), { outcome: 'unknown' }); assert.equal(posts, 2);
    await controller.close(); restart(); await coordinator.load();
    assert.deepEqual(await answer(unknown, { operationId: unknownOperation }), { outcome: 'already_used' }); assert.equal(posts, 2);
    mode = 'redirect'; const redirected = await controller.challenge(true);
    assert.deepEqual(await answer(redirected), { outcome: 'new_challenge' }); assert.equal(posts, 3); assert.equal(forbidden, 0);
    mode = 'reject'; const tampered = await controller.challenge(true);
    await controller.page.locator('[name=_xsrf]').evaluate(el => { el.value = 'tampered'; });
    assert.deepEqual(await answer(tampered), { outcome: 'stale' }); assert.equal(posts, 3);
    // A restarted legacy record with no fingerprint consumes the first observed
    // baseline; a separate explicit refresh is needed to create a usable key.
    await coordinator.write({ seedRequired: true });
    const baselineKey = keyNumber + 1;
    const final = await controller.challenge(true);
    assert.equal(coordinator.state.seedRequired, false); assert.ok(coordinator.state.claims.includes(hashKey(`picture-${baselineKey}`)));
    assert.equal(keyNumber, baselineKey + 1); mode = 'success';
    assert.deepEqual(await answer(final), { outcome: 'solved' }); assert.equal(posts, 4); assert.equal(forbidden, 0);
    assert.equal((await journal.read()).phase, 'resolved'); coordinator.assertAutomatic();
    assert.deepEqual(await controller.challenge(false), { outcome: 'idle' });
    assert.deepEqual(await answer(final), { outcome: 'stale' }); assert.equal(posts, 4);
    // Exact-target reader proof: a different valid vacancy does not resolve.
    await coordinator.pending({ target, recoveryId }); mode = 'wrong-target';
    await assert.rejects(controller.challenge(false), { code: 'JOB_CAPTCHA_UNAVAILABLE' });
    assert.equal(coordinator.status().phase, 'active'); assert.equal(posts, 4);
  } finally { await controller?.close(); await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});
