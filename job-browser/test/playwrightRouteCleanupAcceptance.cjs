const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { closeGuardedPage } = require('../src/pageCleanup');

async function fixture(html) {
  let posts = 0;
  const server = http.createServer((request, response) => {
    if (request.method === 'POST') posts++;
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-route-patch-'));
  const context = await chromium.launchPersistentContext(root, { headless: true, chromiumSandbox: true,
    serviceWorkers: 'block' });
  return { context, origin: `http://127.0.0.1:${server.address().port}`, posts: () => posts,
    close: async () => {
      await context.close();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    } };
}

test('direct page closure releases unhandled GET routes',
  { skip: process.platform !== 'linux', timeout: 60000 }, async () => {
    const html = `<html><body><script>
      for(let i=0;i<30;i++)fetch('/slow/'+i).catch(()=>{});
    </script></body></html>`;
    const f = await fixture(html);
    try {
      const implementation = f.context._connection.toImpl(f.context);
      let sawRouteChain = false;
      await f.context.route('**/*', route => {
        sawRouteChain ||= implementation._routesInFlight.size > 0;
        if (route.request().method() === 'POST') {
          return route.abort();
        }
        return route.request().url().startsWith(f.origin) ? route.continue() : route.abort();
      });
      await f.context.routeWebSocket('**/*', socket => socket.close());
      for (let i = 0; i < 30; i++) {
        const page = await f.context.newPage();
        await page.routeWebSocket('**/*', socket => socket.close());
        await page.route('**/*', route => route.fallback());
        await page.goto(f.origin, { waitUntil: 'domcontentloaded' });
        await page.close(); // Deliberately bypass Jarvis cleanup to exercise the pinned patch.
        assert.equal(implementation._routesInFlight.size, 0);
      }
      assert.equal(sawRouteChain, true);
      assert.equal(f.posts(), 0);
    } finally { await f.close(); }
  });

test('managed closure preserves the context POST guard with periodic page requests',
  { skip: process.platform !== 'linux', timeout: 60000 }, async () => {
    const f = await fixture(`<html><body><script>
      for(let i=0;i<30;i++)fetch('/slow/'+i).catch(()=>{});
      const mutate=()=>fetch('/mutate',{method:'POST',body:'fixture'}).catch(()=>{});
      mutate(); setInterval(mutate,20);
    </script></body></html>`);
    try {
      let blockedPosts = 0, seenPost;
      await f.context.route('**/*', route => {
        if (route.request().method() === 'POST') {
          blockedPosts++; seenPost?.(); return route.abort();
        }
        return route.request().url().startsWith(f.origin) ? route.continue() : route.abort();
      });
      for (let i = 0; i < 100; i++) {
        const blocked = new Promise(resolve => { seenPost = resolve; });
        const page = await f.context.newPage();
        await page.route('**/*', route => route.fallback());
        await page.goto(f.origin, { waitUntil: 'domcontentloaded' });
        await blocked;
        await closeGuardedPage(page);
        assert.equal(f.context._connection.toImpl(f.context)._routesInFlight.size, 0);
      }
      assert.ok(blockedPosts >= 100);
      assert.equal(f.posts(), 0);
    } finally { await f.close(); }
  });

test('a scripted about:blank document is replaced before the target is closed',
  { skip: process.platform !== 'linux', timeout: 60000 }, async () => {
    const f = await fixture('<html><body>fixture</body></html>');
    try {
      for (let i = 0; i < 30; i++) {
        const page = await f.context.newPage();
        assert.equal(page.url(), 'about:blank');
        await page.setContent('<script>window.oldDocument=true;window.n=0;setInterval(()=>n++,5)</script>');
        await page.waitForFunction(() => window.n > 0);
        const close = page.close.bind(page);
        page.close = async (...args) => {
          assert.equal(await page.evaluate(() => window.oldDocument === true), false);
          return close(...args);
        };
        await closeGuardedPage(page);
        assert.equal(f.context._connection.toImpl(f.context)._routesInFlight.size, 0);
      }
    } finally { await f.close(); }
  });

test('delegate failures reject but do not retain handled routes while page remains open',
  { skip: process.platform !== 'linux', timeout: 60000 }, async () => {
    const f = await fixture('<html><body>fixture</body></html>');
    try {
      const implementation = f.context._connection.toImpl(f.context);
      for (const method of ['continue', 'abort', 'fulfill']) {
        const page = await f.context.newPage();
        let entered, release, done, rejected = false;
        const seen = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const handled = new Promise(resolve => { done = resolve; });
        await page.route('**/*', async route => {
          entered(); await gate;
          try {
            if (method === 'fulfill') await route.fulfill({ status: 204 });
            else await route[method]();
          } catch { rejected = true; }
          finally { done(); }
        });
        const navigation = page.goto(f.origin, { timeout: 1000 }).catch(() => {});
        await seen;
        assert.equal(implementation._routesInFlight.size, 1);
        const serverRoute = [...implementation._routesInFlight][0];
        serverRoute._delegate[method] = async () => { throw new Error('FIXTURE_DELEGATE_FAILURE'); };
        release(); await handled;
        assert.equal(rejected, true);
        assert.equal(serverRoute._handled, true);
        assert.equal(implementation._routesInFlight.size, 0);
        await page.close(); await navigation;
      }
      assert.equal(f.posts(), 0);
    } finally { await f.close(); }
  });
