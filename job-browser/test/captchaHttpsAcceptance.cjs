const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { HhBrowser } = require('../src/hhBrowser');
const { CaptchaJournal } = require('../src/captchaJournal');
const { CaptchaRecovery } = require('../src/captchaRecovery');
const { allowedRequest } = require('../src/networkPolicy');

test('local HTTPS: actual captcha dispatch updates browser cookies and never follows POST redirects', { timeout: 45000 }, async () => {
  // Container-only fixture: --network none --add-host hh.ru:127.0.0.1.
  // Ephemeral TLS key is generated in private tmpfs, never stored in the repository.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-https-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, 'key'),
    '-out', path.join(root, 'cert'), '-subj', '/CN=hh.ru', '-days', '1'], { stdio: 'ignore' });
  const ownerId = randomUUID(); let now = 2000000000000;
  let posts = 0, inits = 0, forbidden = 0, reject = false, ocrCalls = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=', 'base64');
  const server = https.createServer({ key: await fs.readFile(path.join(root, 'key')), cert: await fs.readFile(path.join(root, 'cert')) }, async (request, response) => {
    const u = new URL(request.url, 'https://hh.ru');
    if (request.method === 'POST' && u.pathname === '/captcha') {
      inits++; response.writeHead(200, { 'content-type': 'application/json' }); return response.end('{"key":"fixture"}');
    }
    if (request.method === 'POST' && u.pathname === '/account/captcha') {
      posts++; let body = ''; for await (const chunk of request) body += chunk;
      const fields = new URLSearchParams(body); assert.equal(fields.get('captchaText'), 'проверка картинки');
      response.writeHead(reject ? 307 : 302, reject ? { location: 'https://hh.ru/forbidden' }
        : { 'set-cookie': 'fixture_captcha=passed; Path=/; Secure; HttpOnly', location: u.searchParams.get('backurl') });
      return response.end();
    }
    if (request.method === 'POST') { forbidden++; response.writeHead(400); return response.end(); }
    if (u.pathname === '/captcha/picture') { response.writeHead(200, { 'content-type': 'image/png' }); return response.end(png); }
    if (u.pathname.startsWith('/vacancy/')) {
      if (reject || !String(request.headers.cookie).includes('fixture_captcha=passed')) {
        response.writeHead(302, { location: `/account/captcha?backurl=${encodeURIComponent(u.pathname)}&state=fixture` }); return response.end();
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return response.end(`<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Fixture HTTPS', datePosted: '2026-10-15T10:00:00+03:00', hiringOrganization: { name: 'Fixture' } })}</script><div data-qa="vacancy-description">Fixture</div>`);
    }
    if (u.pathname === '/account/captcha') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return response.end(`<h1>Подтвердите, что вы не робот</h1><img id="picture" alt="captcha" src="">
      <form method="post" action="${u.href.replace(/&/g, '&amp;')}"><input type="hidden" name="_xsrf" value="fixture-xsrf">
      <input type="text" name="captchaText"><input type="hidden" name="isBot" value="false"><button type="submit">Продолжить</button></form>
      <script>fetch('/captcha?lang=RU',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}}).then(r=>r.json()).then(()=>picture.src='/captcha/picture?key=fixture').catch(()=>{});</script>`);
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve) => server.listen(443, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  await context.route('**/*', (route) => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && allowedRequest(route.request().url()) ? route.continue() : route.abort());
  const journal = new CaptchaJournal({ root, ownerId });
  const hh = new HhBrowser({ context, captchaRecovery: new CaptchaRecovery({ journal, now: () => now, responseTimeoutMs: 1000,
    recognize: async () => { ocrCalls++; return 'проверка картинки'; } }) });
  try {
    await assert.rejects(hh.getVacancy({ externalId: '123' }), { code: 'JOB_HH_CAPTCHA_WAITING' });
    now += 120000;
    assert.equal((await hh.getVacancy({ externalId: '123' })).title, 'Fixture HTTPS');
    assert.equal(posts, 1); assert.equal(inits, 1); assert.equal((await journal.read()).phase, 'resolved');
    assert.ok((await context.cookies('https://hh.ru')).some((c) => c.name === 'fixture_captcha' && c.value === 'passed'));
    reject = true;
    await assert.rejects(hh.getVacancy({ externalId: '124' }), { code: 'JOB_HH_CAPTCHA_WAITING' });
    now += 120000;
    await assert.rejects(hh.getVacancy({ externalId: '124' }), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    assert.equal(posts, 2); assert.equal(forbidden, 0);
  } catch (error) {
    process.stdout.write(`FIXTURE_HTTPS_COUNTS ${JSON.stringify({ posts, inits, forbidden, ocrCalls, phase: (await journal.read())?.phase })}\n`);
    throw error;
  } finally { await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});
