// Production assets under the existing Operations CSP, using synthetic API data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../job-browser/node_modules/playwright');
const { responseFor } = require('./fixtures/operationsPreview.cjs');
const root = path.resolve(__dirname, '../ops-ui/dist');
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";
assert.ok(fs.readFileSync(path.resolve(__dirname, '../server/src/app.js'), 'utf8').includes(policy), 'test matches the existing Operations CSP');
const server = http.createServer((request, response) => {
  response.setHeader('Content-Security-Policy', policy);
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method !== 'GET') { response.writeHead(403).end(); return; }
  if (url.pathname.startsWith('/ops/api/')) {
    if (url.pathname.endsWith('/stream')) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(': fixture\n\n'); return; }
    const data = responseFor(url.pathname.slice(8));
    response.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(data ? { ok: true, ...data } : {})); return;
  }
  const file = url.pathname === '/ops/' ? 'index.html' : url.pathname.startsWith('/ops/assets/') ? path.join('assets', path.basename(url.pathname)) : null;
  if (!file || !fs.existsSync(path.join(root, file))) { response.writeHead(404).end(); return; }
  const type = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : 'text/html';
  response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(fs.readFileSync(path.join(root, file)));
});
let browser;
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.cspViolations.push(event.effectiveDirective));
    window.EventSource = class extends EventTarget { close() {} };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/ops/`);
  await page.locator('[data-scene-state="ready"]').waitFor();
  // The approved sky must actually decode under the production policy; silently
  // falling back to stars would otherwise let this test pass with a broken URL.
  assert.equal(await page.evaluate(async () => {
    const image = new Image(); image.src = '/ops/assets/milky-way-reference-narrow.webp';
    await image.decode(); return image.naturalWidth > 1000;
  }), true, 'local sky texture decodes under existing CSP');
  assert.equal(await page.locator('.orbital-header').evaluate((el) => getComputedStyle(el).height), '74px');
  await page.locator('[data-nav="services"]').click();
  await page.getByRole('heading', { name: 'Сервисы', level: 1 }).waitFor();
  assert.ok(await page.evaluate(async () => (await document.fonts.load('16px Inter')).length > 0), 'local Inter font loads under CSP');
  await page.getByRole('button', { name: 'Перезапустить', exact: true }).click();
  await page.getByRole('dialog', { name: 'Перезапустить / Jarvis Server' }).waitFor();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: /Логи Просмотр/ }).click();
  await page.getByRole('dialog', { name: 'Jarvis Server', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  for (const section of ['overview', 'infrastructure', 'connections', 'parser', 'incidents', 'events', 'backups', 'sessions']) {
    await page.evaluate((section) => { location.hash = `/${section}`; }, section);
    await page.locator('#workspace-content h1').waitFor();
    await page.waitForFunction(() => !document.querySelector('.read-state.is-loading'));
  }
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
  assert.deepEqual(errors, []);
  console.log('PASS production assets, existing CSP, WebGL, real service workspace and nested confirmation');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
