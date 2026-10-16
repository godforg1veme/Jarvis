'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { chromium = require('../../job-browser/node_modules/playwright').chromium; } catch { /* Optional integration runtime. */ }
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const available = chromium && (fs.existsSync(edge) || fs.existsSync(chromium.executablePath()));
test('mobile UI touch flow, Cyrillic keyboard and failed/successful finish', { skip: available ? false : 'Requires installed Playwright browser from job-browser integration runtime' }, async () => {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(edge) ? { executablePath: edge } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); let state = { phase: 'pending', revision: 1 }, finishCount = 0;
    const rfbFixture = `export default class RFB extends EventTarget { constructor(target,url){super();window.keyEvents=[];window.remoteUrl=url;const screen=document.createElement('canvas');screen.width=800;screen.height=600;target.append(screen);screen.addEventListener('touchstart',()=>{window.touchSeen=true;});}sendKey(...key){window.keyEvents.push(key);}disconnect(){this.dispatchEvent(new Event('disconnect'));}}`;
    await page.route('https://jarvis.test.ts.net/hh/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/hh/novnc/core/rfb.js') return route.fulfill({ contentType: 'text/javascript', body: rfbFixture });
      if (url.pathname.startsWith('/hh/api/')) {
        if (url.pathname.endsWith('/start')) state = { phase: 'active', revision: state.revision + 1 };
        if (url.pathname.endsWith('/finish')) state = { phase: ++finishCount === 1 ? 'active' : 'idle', revision: state.revision + 1 };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, value: state, csrf: 'fixture' }) });
      }
      const name = url.pathname === '/hh/' ? 'index.html' : url.pathname.slice('/hh/'.length);
      const contentType = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: fs.readFileSync(path.resolve(__dirname, '../public', name)) });
    });
    await page.goto('https://jarvis.test.ts.net/hh/');
    await page.getByRole('button', { name: 'Начать ручную проверку' }).tap();
    await page.locator('#screen canvas').waitFor(); await page.locator('#screen canvas').tap({ position: { x: 50, y: 50 } });
    assert.equal(await page.evaluate(() => window.touchSeen), true);
    await page.locator('#keyboard').fill('Привет');
    assert.equal(await page.evaluate(() => window.keyEvents.length), 6);
    assert.equal(await page.evaluate(() => window.keyEvents[0][0]), 0x0100041f);
    assert.match(await page.evaluate(() => window.remoteUrl), /^wss:\/\/jarvis\.test\.ts\.net\/hh\/transport\?revision=2$/);
    await page.getByRole('button', { name: 'Обновить проверку' }).tap();
    await page.waitForFunction(() => window.remoteUrl.endsWith('revision=3'));
    await page.getByRole('button', { name: 'Готово', exact: true }).tap();
    await page.locator('#screen canvas').waitFor();
    assert.match(await page.locator('#status').textContent(), /Сбор приостановлен/);
    await page.getByRole('button', { name: 'Готово', exact: true }).tap();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('не требуется'));
    assert.equal(await page.locator('#screen canvas').count(), 0);
    await context.close();
  } finally { await browser.close(); }
});
