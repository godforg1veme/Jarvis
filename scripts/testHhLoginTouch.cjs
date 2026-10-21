const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { chromium } = require('../job-browser/node_modules/playwright');
const { HhBrowser } = require('../job-browser/src/hhBrowser');

const root = path.resolve(__dirname, '../mini-app/dist');
const remoteHtml = `<style>*{box-sizing:border-box}body{margin:0;background:white}input,button{position:absolute;height:44px;width:300px;left:100px;font:20px sans-serif}
 #phone{top:120px}#password{top:200px}button{top:300px}</style>
 <input id="phone" type="tel" inputmode="tel"><input id="password" type="password">
 <button onclick="window.clicked=(window.clicked||0)+1">Далее</button>`;
const server = http.createServer(async (req, res) => {
  if (req.url === '/hh-fixture') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(remoteHtml); return; }
  const name = new URL(req.url, 'http://localhost').pathname.replace(/^\/mini\//, '');
  if (!['job-connect/', 'jobConnect.js', 'api.js', 'style.css'].includes(name)) { res.writeHead(404).end(); return; }
  const filename = name === 'job-connect/' ? 'job-connect.html' : name;
  try { res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(await fs.readFile(path.join(root, filename))); }
  catch { res.writeHead(404).end(); }
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width === 390 });
      const remote = await context.newPage();
      await remote.setViewportSize({ width: 1024, height: 768 });
      await remote.goto(`${origin}/hh-fixture`);
      const runtime = new HhBrowser({ context });
      const sessionId = randomUUID(); runtime.loginPage = remote; runtime.loginSessionId = sessionId;
      runtime.loginState = 'waiting'; runtime.loginExpiresAt = Date.now() + 600000; runtime.loginMainStatus = 200;
      let dropAcknowledgement = false, rejectInput = false, textCalls = 0;
      await context.route('**/mini/api/jobs/login/**', async (route) => {
        const endpoint = new URL(route.request().url()).pathname;
        const send = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...data }) });
        if (endpoint.endsWith('/claim')) return send({ sessionId });
        if (endpoint.includes('/status/')) return send({ status: 'claimed', ...await runtime.loginStatus({ sessionId }) });
        if (endpoint.includes('/frame/')) return send(await runtime.loginFrame({ sessionId }));
        if (endpoint.includes('/input/')) {
          const body = route.request().postDataJSON();
          if (body.event.type === 'text') textCalls++;
          if (rejectInput && body.event.type === 'text') return route.abort();
          const result = await runtime.loginInput({ sessionId, ...body });
          if (dropAcknowledgement && body.event.type === 'text') { dropAcknowledgement = false; return route.abort(); }
          return send(result);
        }
        if (endpoint.endsWith('/guest/cancel')) { await runtime.closeLogin({ sessionId }); return send({ status: 'cancelled' }); }
        throw new Error('Unexpected fixture endpoint');
      });
      const page = await context.newPage(); const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.name));
      await page.goto(`${origin}/mini/job-connect/#ticket=${randomBytes(32).toString('hex')}`);
      const image = page.locator('#job-connect-frame'), direct = page.locator('#job-connect-direct');
      await image.waitFor({ state: 'visible' });
      const tap = async (x, y) => {
        const rect = await image.boundingBox();
        await page.touchscreen.tap(rect.x + x * rect.width / 1024, rect.y + y * rect.height / 768);
      };
      const waitValue = async (id, value) => {
        await remote.waitForFunction(({ id, value }) => document.getElementById(id).value === value, { id, value });
      };
      await tap(150, 140); await direct.waitFor({ state: 'visible' });
      assert.equal(await direct.evaluate((node) => node === document.activeElement), true);
      await direct.pressSequentially('12345'); await waitValue('phone', '12345');
      await direct.press('Backspace'); await waitValue('phone', '1234');
      await direct.fill('1984'); await waitValue('phone', '1984');
      dropAcknowledgement = true;
      const before = textCalls;
      await direct.pressSequentially('6'); await waitValue('phone', '19846');
      await page.waitForFunction(() => document.querySelector('#job-connect-status').textContent.includes('Ввод передан'));
      assert.equal(textCalls - before, 1, 'Lost acknowledgement must not duplicate input');
      await tap(150, 320); await remote.waitForFunction(() => window.clicked === 1);
      assert.equal(await direct.isHidden(), true);
      await tap(150, 220); await direct.waitFor({ state: 'visible' });
      assert.equal(await direct.getAttribute('type'), 'password');
      await direct.fill('Синтетика🙂'); await waitValue('password', 'Синтетика🙂');
      await direct.press('Backspace'); await waitValue('password', 'Синтетика');
      await direct.fill('Синтетика👨‍👩‍👧‍👦'); await waitValue('password', 'Синтетика👨‍👩‍👧‍👦');
      await direct.press('Backspace'); await waitValue('password', 'Синтетика');
      await direct.evaluate((node) => {
        node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        node.value = 'Синтетика界';
        node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      });
      assert.equal(await remote.locator('#password').inputValue(), 'Синтетика');
      await direct.dispatchEvent('compositionend'); await waitValue('password', 'Синтетика界');
      await direct.fill('Синтетика'); await waitValue('password', 'Синтетика');
      const fallback = page.locator('#job-connect-input');
      await fallback.fill('Z'); await page.locator('#job-connect-send').click();
      await waitValue('password', 'СинтетикаZ');
      await page.waitForFunction(() => document.querySelector('#job-connect-input').value === '');
      assert.equal(await fallback.inputValue(), '');
      for (const id of ['send', 'reveal', 'enter', 'tab', 'cancel']) assert.equal(await page.locator(`#job-connect-${id}`).isVisible(), true);
      assert.equal(await page.evaluate(() => JSON.stringify({ ...sessionStorage }).includes('Синтетика')), false);
      if (width === 390) {
        const output = path.resolve(__dirname, '../.superpowers/hh-login-touch'); await fs.mkdir(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      }
      await tap(150, 140); await direct.waitFor({ state: 'visible' });
      rejectInput = true; const rejectedBefore = textCalls;
      await direct.fill('9'); await direct.waitFor({ state: 'hidden' });
      assert.equal(textCalls - rejectedBefore, 1);
      assert.equal(await remote.locator('#phone').inputValue(), '19846');
      await page.locator('#job-connect-cancel').click(); await page.locator('#job-connect-stage').waitFor({ state: 'hidden' });
      assert.equal(await direct.inputValue(), ''); assert.equal(await fallback.inputValue(), '');
      assert.deepEqual(pageErrors, []);
      await context.close();
      console.log(`HH touch and keyboard fixture passed at ${width}px`);
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
