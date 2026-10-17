// Starts an isolated local Vite server; every API response is synthetic.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../job-browser/node_modules/playwright');

(async () => {
  const server = spawn(process.execPath, [path.resolve(__dirname, '../ops-ui/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { cwd: path.resolve(__dirname, '../ops-ui'), windowsHide: true, stdio: 'pipe' });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Fixture server exited: ${output}`);
      try { ready = output.includes('http://127.0.0.1:5183') && (await fetch('http://127.0.0.1:5183/ops/')).ok; } catch { /* startup */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'local fixture server started');
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    for (const failure of ['503', 'network', '403', '401']) {
      const page = await browser.newPage({ viewport: { width: failure === '503' ? 320 : 1280, height: 900 } });
      page.setDefaultTimeout(8000);
      const errors = [];
      let state = failure;
      let approvals = 0;
      let overviewRequests = 0;
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        class FixtureStream extends EventTarget {
          constructor() { super(); window.fixtureStream = this; }
          close() { this.closed = true; }
        }
        window.EventSource = FixtureStream;
      });
      await page.route('**/ops/api/**', async (route) => {
        const api = new URL(route.request().url()).pathname;
        if (api.endsWith('/overview')) {
          overviewRequests += 1;
          if (state === 'network') return route.abort('failed');
          if (state !== 'success') return route.fulfill({ status: Number(state), json: { error: 'fixture-private-detail' } });
          return route.fulfill({ json: { overview: { host_key: 'fixture', label: 'Fixture host', status: 'healthy', last_contact_at: null, services: [] } } });
        }
        if (api.endsWith('/session/request')) approvals += 1;
        return route.fulfill({ json: { checks: [] } });
      });
      await page.goto('http://127.0.0.1:5183/ops/');
      if (failure === '401') {
        await page.getByRole('button', { name: 'Подтвердить в Telegram' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Повторить подключение' }).count(), 0);
      } else {
        await page.getByRole('heading', { name: 'Панель временно недоступна' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Подтвердить в Telegram' }).count(), 0);
        assert.equal(await page.getByRole('navigation').count(), 0, 'unverified session gets no protected console');
        assert.equal((await page.locator('body').innerText()).includes('fixture-private-detail'), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'unavailable view fits the viewport');
        if (failure === '503') {
          const repeatedFailure = page.waitForResponse((response) => response.url().endsWith('/overview') && response.status() === 503);
          await page.getByRole('button', { name: 'Повторить подключение' }).click();
          await repeatedFailure;
          await page.getByRole('heading', { name: 'Панель временно недоступна' }).waitFor();
          assert.equal(overviewRequests, 2, 'failed retry remains recoverable');
        }
        state = 'success';
        await page.getByRole('button', { name: 'Повторить подключение' }).click();
        await page.getByRole('heading', { name: 'Обзор', exact: true }).waitFor();
        await page.waitForFunction(() => Boolean(window.fixtureStream));
        state = '401';
        await page.evaluate(() => window.fixtureStream.dispatchEvent(new Event('error')));
        await page.getByRole('button', { name: 'Подтвердить в Telegram' }).waitFor();
        assert.equal(await page.getByRole('navigation').count(), 0, 'expired session hides protected console');
        assert.equal(await page.evaluate(() => window.fixtureStream.closed), true);
        assert.ok(overviewRequests >= 3);
      }
      assert.equal(approvals, 0, 'outage never starts a new approval');
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS Operations bootstrap ${failure}, recovery and session boundary`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
