const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { HhBrowser } = require('../src/hhBrowser');
const { CaptchaJournal } = require('../src/captchaJournal');
const { CaptchaRecovery } = require('../src/captchaRecovery');

for (const nativeQuery of [false, true]) test(`Chromium ${nativeQuery ? 'native XHR' : 'body'}: wait, exact captcha posts, successful read, unknown restart and foreign owner`, { timeout: 90000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-captcha-'));
  const ownerId = randomUUID(); let now = 2000000000000;
  let solved = false, rejectAnswer = false, loseReceipt = false, tamper = false, oversizedImage = false, denyAfterAnswer = false;
  let initializations = 0, answers = 0, unexpectedWrites = 0, ocrCalls = 0;
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  context.on('page', (page) => page.on('requestfailed', (request) => {
    if (request.isNavigationRequest()) process.stdout.write(`FIXTURE_NAVIGATION_FAILURE ${new URL(request.url()).pathname} ${request.failure()?.errorText}\n`);
  }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=', 'base64');
  await context.route('**/*', async (route) => {
    const request = route.request(), u = new URL(request.url());
    if (request.method() === 'POST') {
      if (u.pathname === '/captcha') { initializations++; return route.fulfill({ contentType: 'application/json', body: '{"key":"fixture"}' }); }
      if (u.pathname === '/account/captcha') {
        answers++;
        const body = nativeQuery ? u.searchParams : new URLSearchParams(request.postData());
        assert.equal(body.get('captchaText'), 'проверка картинки');
        if (nativeQuery) {
          assert.equal(request.resourceType(), 'xhr'); assert.equal(request.postDataBuffer(), null);
          assert.equal(request.headers()['x-xsrftoken'], 'fixture-xsrf');
          assert.equal(body.get('captchaKey'), 'fixture'); assert.equal(body.get('captchaState'), 'fixture');
        } else { assert.equal(body.get('_xsrf'), 'fixture-xsrf'); assert.equal(body.get('isBot'), 'false'); }
        if (!rejectAnswer) solved = true;
        return loseReceipt ? route.abort() : route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      unexpectedWrites++; return route.abort();
    }
    if (u.pathname.startsWith('/vacancy/')) {
      if (denyAfterAnswer && answers >= 4) return route.fulfill({ status: 403, contentType: 'text/html', body: 'Access denied' });
      // Playwright does not re-route the destination of a fulfilled HTTP redirect.
      // A client navigation keeps both pages in the real browser while network stays off.
      if (!solved) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>setTimeout(()=>location.assign(${JSON.stringify(`/account/captcha?backurl=${encodeURIComponent(u.pathname)}&state=fixture`)}),50)</script>` });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Fixture AI', datePosted: '2026-10-15T10:00:00+03:00', hiringOrganization: { name: 'Fixture' } })}</script><div data-qa="vacancy-description">Fixture</div>` });
    }
    if (u.pathname === '/captcha/picture') return route.fulfill({ contentType: 'image/png', body: png });
    if (u.pathname === '/account/captcha') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <h1>Подтвердите, что вы не робот</h1><img id="picture" src="" alt="captcha" ${oversizedImage ? 'style="width:3000px;height:300px"' : ''}>
      <form method="post" action="${u.href.replace(/&/g, '&amp;')}">
      <input type="hidden" name="_xsrf" value="fixture-xsrf"><input type="text" name="captchaText"><input type="hidden" name="isBot" value="false">
      <button type="submit">Продолжить</button></form>
      <script>
      const init=()=>fetch('/captcha?lang=RU',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}}).then(r=>r.json()).then(()=>document.querySelector('img').src='/captcha/picture?key=fixture').catch(()=>{});
      init();init();fetch('/unexpected-write',{method:'POST'}).catch(()=>{});
      document.querySelector('form').onsubmit=e=>{e.preventDefault();${tamper ? "document.querySelector('[name=isBot]').value='true';" : ''}
        const f=e.currentTarget;const send=()=>{${nativeQuery ? `const a=new URL(f.action); const q=new URLSearchParams({captchaText:f.elements.captchaText.value,captchaKey:'fixture',captchaState:a.searchParams.get('state'),backurl:a.searchParams.get('backurl'),failurl:f.action});
          const x=new XMLHttpRequest();x.open('POST','/account/captcha?'+q);x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');x.setRequestHeader('X-Xsrftoken',${tamper ? "'wrong'" : 'f.elements._xsrf.value'});x.send();` : `fetch(f.action,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(f)).toString()}).catch(()=>{});`}};send();send();};
      </script>` });
    return route.abort();
  });
  const journal = () => new CaptchaJournal({ root, ownerId });
  const make = () => new HhBrowser({ context, captchaDispatch: (route) => route.fallback(), captchaRecovery: new CaptchaRecovery({
    journal: journal(), now: () => now, responseTimeoutMs: 300, recognize: async () => { ocrCalls++; return 'проверка картинки'; } }) });
  try {
    let hh = make();
    await assert.rejects(hh.getVacancy({ externalId: '123' }), (e) => e.code === 'JOB_HH_CAPTCHA_WAITING' && e.retryAfterMs === 120000);
    assert.equal(initializations, 0); assert.equal(answers, 0);
    assert.equal((await journal().read()).phase, 'waiting');
    now += 120000;
    assert.equal((await hh.getVacancy({ externalId: '123' })).title, 'Fixture AI');
    assert.equal(initializations, 1); assert.equal(answers, 1); assert.equal(ocrCalls, 1);
    assert.equal((await journal().read()).phase, 'resolved');
    // A lost acknowledgement still reconciles by GET, without a second mutation.
    solved = false; loseReceipt = true;
    await assert.rejects(hh.getVacancy({ externalId: '124' }), { code: 'JOB_HH_CAPTCHA_WAITING' });
    now += 120000;
    assert.equal((await hh.getVacancy({ externalId: '124' })).title, 'Fixture AI');
    assert.equal(answers, 2);
    // An unverified answer survives restart and cannot be submitted again.
    solved = false; rejectAnswer = true; loseReceipt = false;
    await assert.rejects(hh.getVacancy({ externalId: '125' }), { code: 'JOB_HH_CAPTCHA_WAITING' });
    now += 120000;
    await assert.rejects(hh.getVacancy({ externalId: '125' }), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    const incident = await journal().read(); assert.equal(incident.phase, 'attempted');
    hh = make(); now += 1800000;
    await assert.rejects(hh.getVacancy({ externalId: '125' }), (e) => e.code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' && e.recoveryId === incident.operationId);
    assert.equal(answers, 3); assert.equal(initializations, 3); assert.equal(ocrCalls, 3);
    await assert.rejects(new CaptchaJournal({ root, ownerId: randomUUID() }).read(), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    // Manual recovery permits reads, then a fresh incident gets its own one-time claim.
    solved = true; await hh.getVacancy({ externalId: '125' });
    solved = false; tamper = true;
    await assert.rejects(hh.getVacancy({ externalId: '126' }), { code: 'JOB_HH_CAPTCHA_WAITING' });
    now += 120000;
    await assert.rejects(hh.getVacancy({ externalId: '126' }), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    assert.equal(answers, 3); assert.equal(unexpectedWrites, 0);
    const beforeRestart = initializations;
    await journal().write({ ...await journal().read(), phase: 'initializing' });
    await assert.rejects(make().getVacancy({ externalId: '126' }), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    assert.equal(initializations, beforeRestart, 'an uncertain initialization is not repeated after restart');
    solved = true; await hh.getVacancy({ externalId: '126' });
    solved = false; tamper = false; oversizedImage = true;
    await assert.rejects(hh.getVacancy({ externalId: '127' }), { code: 'JOB_HH_CAPTCHA_WAITING' });
    now += 120000; const beforeOversized = ocrCalls;
    await assert.rejects(hh.getVacancy({ externalId: '127' }), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    assert.equal(ocrCalls, beforeOversized, 'oversized CSS capture is refused before screenshot and OCR');
    assert.equal(answers, 3);
    solved = true; await hh.getVacancy({ externalId: '127' });
    solved = false; oversizedImage = false; denyAfterAnswer = true;
    await assert.rejects(hh.getVacancy({ externalId: '128' }), { code: 'JOB_HH_CAPTCHA_WAITING' });
    now += 120000;
    await assert.rejects(hh.getVacancy({ externalId: '128' }), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    assert.equal(answers, 4, 'failed read-only reconciliation becomes a manual-required incident');
    assert.equal((await fs.stat(path.join(root, 'state.json'))).mode & 0o777, 0o600);
  } finally { await context.close(); await browser.close(); await fs.rm(root, { recursive: true, force: true }); }
});
