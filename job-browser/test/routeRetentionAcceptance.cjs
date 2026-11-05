// Run explicitly with node --expose-gc --test test/routeRetentionAcceptance.cjs.
// JOB_ROUTE_BASELINE=1 measures the old direct-close behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { newGuardedPage } = require('../src/webSocketGuard');
const { closeGuardedPage } = require('../src/pageCleanup');
const { BrowserHealth } = require('../src/browserHealth');

test('closed pages do not retain delayed GET routes in a persistent context',
  { skip: process.platform !== 'linux' }, async () => {
    const soakText = process.env.JOB_ROUTE_SOAK_MS;
    const soakMs = soakText === undefined ? 0 : Number(soakText);
    if (soakText !== undefined && (!/^\d+$/.test(soakText) || !Number.isSafeInteger(soakMs)
      || soakMs < 1 || soakMs > 3600000)) throw new Error('JOB_ROUTE_SOAK_CONFIG_INVALID');
    if (soakMs && (process.env.JOB_ROUTE_BASELINE === '1' || typeof global.gc !== 'function'))
      throw new Error('JOB_ROUTE_SOAK_CONFIG_INVALID');
    const html = `<html><body><script>for(let i=0;i<30;i++)fetch('/slow/'+i).catch(()=>{})</script></body></html>`;
    const server = http.createServer((request, response) => {
      if (request.url.startsWith('/slow/')) {
        setTimeout(() => {
          if (response.destroyed) return;
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(Buffer.alloc(32768));
        }, 500);
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-route-retention-'));
    let context, health;
    try {
      context = await chromium.launchPersistentContext(root, { headless: true, chromiumSandbox: true,
        serviceWorkers: 'block' });
      const origin = `http://127.0.0.1:${server.address().port}`;
      await context.route('**/*', route => route.request().url().startsWith(origin)
        ? route.continue() : route.abort());
      await context.routeWebSocket('**/*', socket => socket.close());
      const implementation = context._connection.toImpl(context);
      const baselineObjects = context._connection._objects.size;
      let fatal = 0, cycles = 0;
      health = new BrowserHealth({ context, onFatal: () => { fatal++; } });
      const sample = phase => {
        global.gc?.();
        const retainedRoutes = implementation._routesInFlight.size;
        const clientObjects = context._connection._objects.size;
        const heapMiB = Math.round(process.memoryUsage().heapUsed / 1048576);
        console.log(JSON.stringify({ phase, elapsedMs: soakMs ? Date.now() - soakStart : 0,
          cycles, retainedRoutes, clientObjects, heapMiB, fatal }));
        assert.equal(clientObjects, baselineObjects);
        if (process.env.JOB_ROUTE_BASELINE !== '1') assert.equal(retainedRoutes, 0);
        assert.equal(fatal, 0);
        return heapMiB;
      };
      const runCycle = async () => {
        const page = await newGuardedPage(context);
        try {
          await page.route('**/*', route => route.fallback());
          await page.goto(origin, { waitUntil: 'domcontentloaded' });
        } finally {
          if (process.env.JOB_ROUTE_BASELINE === '1') await page.close();
          else await closeGuardedPage(page);
        }
        cycles++;
      };
      for (let i = 0; i < 100; i++) await runCycle();
      const soakStart = Date.now();
      const warmupHeapMiB = sample('warmup');
      let nextCheckpoint = soakStart + 300000;
      while (soakMs && Date.now() - soakStart < soakMs) {
        await runCycle();
        if (cycles % 20 === 0) assert.equal(await health.check(), true);
        if (Date.now() >= nextCheckpoint) {
          assert.ok(sample('checkpoint') <= warmupHeapMiB + 24);
          nextCheckpoint += 300000;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const finalHeapMiB = sample('final');
      if (soakMs) assert.ok(finalHeapMiB <= warmupHeapMiB + 24);
    } finally {
      health?.close();
      await context?.close();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
