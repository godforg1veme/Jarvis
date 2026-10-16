const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { ManualState } = require('../src/manualState');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { ManualBrowser } = require('../src/manualBrowser');
const { CaptchaJournal } = require('../src/captchaJournal');
const { HhBrowser } = require('../src/hhBrowser');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=', 'base64');
test('actual Chromium manual captcha: one challenge, dispatch drain, exact read, durable restart and legacy unknown', { timeout: 90000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manual-browser-')); await fs.chmod(root, 0o700);
  const ownerId = randomUUID(), recoveryId = randomUUID(), target = 'https://hh.ru/vacancy/123';
  let solved = false, posts = 0, inits = 0, writes = 0, gets = 0, key = 'fixture-key', delay = null;
  const denied = [];
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let pageController;
  const fixture = async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'POST') {
      if (u.pathname === '/captcha') { inits++; return route.fulfill({ contentType: 'application/json', body: '{"key":"fixture"}' }); }
      if (u.pathname === '/account/captcha') { posts++; solved = true; return route.fulfill({ status: 204 }); }
      writes++; return route.abort();
    }
    if (u.pathname === '/captcha/picture') return route.fulfill({ contentType: 'image/png', body: png });
    if (u.pathname === '/search/vacancy') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>1 вакансия</h1><div data-qa="vacancy-serp__vacancy"><a href="/vacancy/123">Fixture</a></div><script>if(new URL(location.href).searchParams.get("page")==="0"){const u=new URL(location.href);u.searchParams.set("page","1");setTimeout(()=>location.assign(u),50)}</script>' });
    if (u.pathname === '/vacancy/123') {
      gets++;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: solved
        ? '<script type="application/ld+json">{"@type":"JobPosting","title":"Fixture","datePosted":"2026-10-16T00:00:00+03:00","hiringOrganization":{"name":"Fixture"}}</script><div data-qa="vacancy-description">Fixture</div>'
        : '<script>location.assign("/account/captcha?backurl=%2Fvacancy%2F123&state=fixture")</script>' });
    }
    if (u.pathname === '/account/captcha') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <h1>Подтвердите, что вы не робот</h1><img src="" id="picture">
      <form action="${u.href.replace(/&/g, '&amp;')}" method="post"><input name="_xsrf" type="hidden" value="fixture-xsrf"><input name="captchaText"><input name="isBot" type="hidden" value="false"><button type="submit">Go</button></form>
      <script>fetch('/captcha?lang=RU',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}}).then(r=>r.json()).then(()=>picture.src='/captcha/picture?key=${key}').catch(()=>{});
      document.querySelector('form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,a=new URL(f.action);const q=new URLSearchParams({captchaText:f.elements.captchaText.value,captchaKey:'${key}',captchaState:a.searchParams.get('state'),backurl:a.searchParams.get('backurl'),failurl:f.action}); const send=()=>{const x=new XMLHttpRequest();x.open('POST','/account/captcha?'+q);x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');x.setRequestHeader('X-Xsrftoken',f.elements._xsrf.value);x.send();};send();send();};</script>` });
    return route.abort();
  };
  await context.route('**/*', fixture);
  await context.route('**/*', async (route) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fallback();
    try { if (pageController && await pageController.permit(route)) return; denied.push('NO_PERMIT'); }
    catch (e) { denied.push(/^JOB_[A-Z_]+$/.test(e.code || '') ? e.code : 'FIXTURE_FAILURE'); }
    return route.abort();
  });
  const store = new ManualState({ root: path.join(root, 'manual'), ownerId });
  const journal = new CaptchaJournal({ root: path.join(root, 'captcha'), ownerId });
  await journal.write({ version: 1, ownerId, operationId: recoveryId, phase: 'attempted', detectedAt: 1, retryAt: 120001,
    targetHash: createHash('sha256').update(target).digest('hex') });
  const manual = new ManualCoordinator({ store, open: (u) => pageController.open(u), verify: (u, id) => pageController.verify(u, id) });
  await manual.load();
  pageController = new ManualBrowser({ context, coordinator: manual, journal, dispatch: async (route) => {
    await fixture(route); if (new URL(route.request().url()).pathname === '/account/captcha' && delay) await delay;
  } });
  const freeze = async () => {
    for (let i = 0; i < 60 && !pageController.frozen; i++) { await pageController.refresh(); await new Promise((r) => setTimeout(r, 50)); }
    assert.ok(pageController.frozen);
  };
  const answer = async () => { await freeze(); await pageController.page.locator('[name=captchaText]').fill('проверка картинки'); await pageController.page.locator('button').click(); };
  try {
    await manual.pending({ target, recoveryId });
    const hh = new HhBrowser({ context, manualCoordinator: manual });
    await assert.rejects(hh.getVacancy({ externalId: '123' }), { code: 'JOB_HH_MANUAL_ACTIVE' }); assert.equal(gets, 0);
    await manual.start(manual.status().revision);
    let release; delay = new Promise((r) => { release = r; });
    await answer();
    for (let i = 0; i < 60 && posts < 1; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(posts, 1, JSON.stringify({ denied, claims: manual.state.claims.length, phase: manual.status().phase })); const before = gets;
    const done = manual.finish(manual.status().revision);
    await new Promise((r) => setTimeout(r, 100)); assert.equal(manual.status().phase, 'checking'); assert.equal(gets, before);
    release(); assert.equal((await done).phase, 'idle'); assert.equal((await journal.read()).phase, 'resolved');
    assert.equal(posts, 1); assert.equal(writes, 0);
    // An unknown legacy attempt has no fingerprint. First observed key is
    // durably barred; only an explicit refresh with a new key permits input.
    solved = false; delay = null;
    await manual.pending({ target, recoveryId, seedRequired: true }); await manual.start(manual.status().revision); await freeze();
    await answer(); await new Promise((r) => setTimeout(r, 100)); assert.equal(posts, 1);
    const restarted = new ManualState({ root: path.join(root, 'manual'), ownerId }); assert.equal((await restarted.read()).claims.length, 1);
    key = 'fresh-fixture-key'; await manual.start(manual.status().revision); await answer();
    for (let i = 0; i < 60 && posts < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(posts, 2); await manual.finish(manual.status().revision);
    // Failed read-only verification preserves the interactive picture and input,
    // closes its temporary page and never initializes a new CAPTCHA by POST.
    solved = false; key = 'preserved-picture-key';
    await manual.pending({ target, recoveryId }); await manual.start(manual.status().revision); await freeze();
    const visiblePage = pageController.page;
    await visiblePage.locator('[name=captchaText]').fill('черновик ответа');
    const visibleUrl = visiblePage.url(), pagesBefore = context.pages().length, initsBefore = inits;
    assert.equal((await manual.finish(manual.status().revision)).phase, 'active');
    assert.equal(pageController.page, visiblePage); assert.equal(visiblePage.url(), visibleUrl);
    assert.equal(await visiblePage.locator('[name=captchaText]').inputValue(), 'черновик ответа');
    assert.equal(await visiblePage.locator('#picture').evaluate(img => img.complete && img.naturalWidth > 0), true);
    assert.equal(context.pages().length, pagesBefore); assert.equal(posts, 2); assert.equal(writes, 0);
    assert.equal(inits, initsBefore);
    // Finish this fixture incident before exercising a different target.
    solved = true; assert.equal((await manual.finish(manual.status().revision)).phase, 'idle');
    // A valid but different search target must not resolve the incident.
    const search = 'https://hh.ru/search/vacancy?text=fixture&search_period=14&order_by=publication_time&items_on_page=20&page=0';
    await manual.pending({ target: search, recoveryId }); await manual.start(manual.status().revision);
    assert.equal((await manual.finish(manual.status().revision)).phase, 'active');
    assert.equal(posts, 2); assert.equal(writes, 0);
  } finally { await pageController.close(); await context.close(); await browser.close(); await fs.rm(root, { recursive: true, force: true }); }
});
