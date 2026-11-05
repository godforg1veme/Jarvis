const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { BrowserHealth } = require('../src/browserHealth');
const { newGuardedPage } = require('../src/webSocketGuard');

test('WebSocket route lifetime: context retention control and page-scoped cleanup',
  { skip: process.platform !== 'linux' }, async () => {
    const cycles = process.env.JOB_WS_STRESS_CYCLES === '500' ? 500 : 100;
    const contextOnly = process.env.JOB_WS_CONTROL === 'context';
    const durationMs = !contextOnly && process.env.JOB_WS_SOAK_SECONDS === '1800' ? 1800000 : 0;
    let upgrades = 0;
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<script>window.socket = new WebSocket(`ws://${location.host}/ws`)</script>');
    });
    server.on('upgrade', (_request, socket) => { upgrades++; socket.destroy(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-ws-guard-'));
    let context, health;
    try {
      context = await chromium.launchPersistentContext(root, { headless: true, chromiumSandbox: true,
        serviceWorkers: 'block' });
      const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
      await context.route('**/*', route => route.request().url().startsWith(fixtureOrigin)
        ? route.continue() : route.abort());
      await context.routeWebSocket('**/*', socket => socket.close());
      health = new BrowserHealth({ context });
      const objects = context._connection._objects;
      const before = objects.size;
      if (global.gc) global.gc();
      const initialHeap = process.memoryUsage().heapUsed;
      const started = Date.now();
      let completed = 0, lastReport = started;
      for (let i = 0; i < cycles || Date.now() - started < durationMs; i++) {
        const page = contextOnly ? await context.newPage() : await newGuardedPage(context);
        try {
          await page.goto(fixtureOrigin, { waitUntil: 'load' });
          await page.waitForFunction(() => window.socket?.readyState === WebSocket.CLOSED, undefined, { timeout: 2000 });
        }
        finally { await page.close(); }
        assert.equal(await health.check(), true);
        assert.equal(objects.size, before + (contextOnly ? i + 1 : 0));
        completed++;
        if (i % 100 === 0 && global.gc) global.gc();
        if (Date.now() - lastReport >= 60000) {
          console.log('JOB_WS_SOAK', JSON.stringify({ cycles: completed, elapsedSeconds: Math.round((Date.now()-started)/1000),
            objects: objects.size, heapMiB: Math.round(process.memoryUsage().heapUsed/1048576) }));
          lastReport = Date.now();
        }
      }
      if (global.gc) global.gc();
      const webSocketRoutes = [...objects.values()].filter(object => object._type === 'WebSocketRoute').length;
      assert.equal(objects.size, before + (contextOnly ? completed : 0));
      assert.equal(webSocketRoutes, contextOnly ? completed : 0);
      assert.equal(upgrades, 0);
      assert.ok(process.memoryUsage().heapUsed < initialHeap + 64 * 1048576);
      console.log('JOB_WS_SOAK_COMPLETE', JSON.stringify({ mode: contextOnly ? 'control' : 'fixed', cycles: completed, elapsedSeconds: Math.round((Date.now()-started)/1000),
        objects: objects.size, webSocketRoutes, upgrades, heapMiB: Math.round(process.memoryUsage().heapUsed/1048576) }));
    } finally {
      health?.close();
      await context?.close();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
