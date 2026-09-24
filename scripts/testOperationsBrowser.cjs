// Run against a local Vite server. All API traffic is synthetic; no production
// credential or mutation is used. PLAYWRIGHT_MODULE may point to a bundled runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const stamp = '2026-09-05T12:00:00Z';
const services = ['jarvis-server', 'postgres', 'cloudflared', 'telegram-parser'].map((key) => ({ key, name: key, state: 'healthy', observedAt: stamp, capabilities: [] }));
const overview = { host_key: 'vps', label: 'Jarvis test VPS', status: 'healthy', last_contact_at: stamp, services };
const profiles = [{ id: 'owner', displayName: 'Тестовый владелец', role: 'owner', telegram: [{ id: 'tg', externalId: '123', connectedAt: stamp }], devices: [{ id: 'pc', name: 'Семейный компьютер', status: 'online', kind: 'computer', lastSeenAt: stamp }] }];
const screens = ['overview', 'infrastructure', 'services', 'connections', 'parser', 'incidents', 'events', 'backups', 'sessions'];
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const output = process.env.JARVIS_UI_SCREENSHOTS;
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/ops/api/**', async (route) => {
        const url = new URL(route.request().url());
        const api = url.pathname.replace('/ops/api', '');
        if (api === '/inventory') return route.fulfill({ json: { ok: true, inventory: { items: [{ name: 'jarvis-family-server-1', type: 'docker', state: 'running' }, { name: 'xray.service', type: 'systemd', state: 'active' }], unavailable: [] } } });
        if (api === '/checks') return route.fulfill({ json: { ok: true, checks: [{ key: 'provider', state: 'healthy', summary: 'Настроенная модель отвечает', checkedAt: stamp }] } });
        if (api === '/stream') return route.fulfill({ contentType: 'text/event-stream', body: ': test\n\n' });
        const body = api === '/overview' ? { overview } : api === '/services' ? { services } : api === '/connections' ? { profiles } : api === '/parser' ? { parser: { service: services[3], results: [] } } : api.includes('/metrics') ? { metrics: [{ name: 'memory_used_percent', value: 50, sampledAt: stamp }] } : api.includes('/logs') ? { state: 'succeeded', logs: ['test log'] } : { incidents: [], events: [], backups: [], sessions: [] };
        return route.fulfill({ json: { ok: true, ...body } });
      });
      await page.goto('http://127.0.0.1:5179/ops/');
      await page.waitForLoadState('networkidle');
      for (const screen of screens) {
        await page.evaluate((screen) => { location.hash = `/${screen}`; }, screen);
        await page.waitForLoadState('networkidle');
        await page.locator('h1').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}/${screen}`);
        if (output) await page.screenshot({ path: path.join(output, `${width}-${screen}.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS: nine screens at ${width}px, no overflow or runtime exceptions`);
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
