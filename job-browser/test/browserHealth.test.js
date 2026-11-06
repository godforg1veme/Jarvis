const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BrowserHealth } = require('../src/browserHealth');
const { createRpcServer } = require('../src/rpcServer');
const { randomUUID } = require('node:crypto');
const { HhBrowser } = require('../src/hhBrowser');

function fixture() {
  const context = new EventEmitter(), page = new EventEmitter(); let probes = 0, closes = 0;
  page.isClosed = () => false; page.evaluate = async fn => { if (fn.toString().includes('window.stop')) return; probes++; return 1; };
  page.goto = async url => { assert.equal(url, 'about:blank'); };
  page.routeWebSocket = async () => {};
  page.close = async () => { closes++; };
  context.pages = () => [page]; context.newPage = async () => page;
  return { context, page, counts: () => ({ probes, closes }) };
}
test('Chromium health executes local JS once for concurrent probes, without navigating HH', async () => {
  const f = fixture(), health = new BrowserHealth({ context: f.context });
  assert.deepEqual(await Promise.all([health.check(), health.check()]), [true, true]);
  assert.equal(f.counts().probes, 1); health.close();
});
test('closed context fails health and triggers fatal only once; normal close suppresses fatal', async () => {
  const f = fixture(); let fatal = 0;
  const health = new BrowserHealth({ context: f.context, onFatal: () => fatal++ });
  f.context.emit('close'); f.context.emit('close'); assert.equal(await health.check(), false); assert.equal(fatal, 1);
  health.close();
  const g = fixture(), normal = new BrowserHealth({ context: g.context, onFatal: () => fatal++ });
  normal.close(); g.context.emit('close'); assert.equal(fatal, 1);
});
test('hung renderer has a bounded probe and fails closed without exposing its error', async () => {
  const f = fixture(); let fatal = 0;
  f.page.evaluate = () => new Promise(() => {});
  const health = new BrowserHealth({ context: f.context, timeoutMs: 20, onFatal: () => fatal++ });
  assert.equal(await health.check(), false); assert.equal(fatal, 1); health.close();
});

test('cleanup failure remains fatal during shutdown while normal context close is ignored', () => {
  const f = fixture(); let fatal = 0;
  const health = new BrowserHealth({ context: f.context, onFatal: () => fatal++ });
  health.close(); f.context.emit('close'); assert.equal(fatal, 0);
  health.failCleanup(); health.failCleanup(); assert.equal(fatal, 1);
});

test('an in-flight probe cleanup still escalates if shutdown starts before cleanup', async () => {
  const f = fixture(); let fatal = 0, finishProbe;
  f.page.evaluate = () => new Promise(resolve => { finishProbe = resolve; });
  f.page.goto = async () => { throw Error('PRIVATE'); };
  const health = new BrowserHealth({ context: f.context, onFatal: () => fatal++ });
  const pending = health.check();
  await new Promise(resolve => setImmediate(resolve));
  health.close(); finishProbe(1);
  assert.equal(await pending, false); assert.equal(fatal, 1);
  assert.equal(f.counts().closes, 0);
});
test('crashed page is never probed or reused for browser health', async () => {
  const f = fixture(), health = new BrowserHealth({ context: f.context });
  f.page.emit('crash'); let freshClosed = false;
  f.context.newPage = async () => ({ routeWebSocket: async () => {}, evaluate: async () => 1, goto: async () => {}, close: async () => { freshClosed = true; } });
  assert.equal(await health.check(), true); assert.equal(f.counts().probes, 0); assert.equal(freshClosed, true); health.close();
});
test('authenticated HTTP health returns 503 for an unusable browser and hides exceptions', async () => {
  const token = 'fixture-health-token-'.repeat(3);
  const rpc = createRpcServer({ ownerId: randomUUID(), token, browser: {}, health: async () => { throw Error('PRIVATE'); } });
  await new Promise(resolve => rpc.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${rpc.address().port}/health`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, code: 'JOB_BROWSER_UNHEALTHY' });
  } finally { await new Promise(resolve => rpc.close(resolve)); }
});
test('stalled browser operation has a deadline and invokes runtime fatal recovery', async () => {
  let fatal = 0;
  const browser = new HhBrowser({ context: { newPage() {} }, operationTimeoutMs:20, onTimeout:()=>fatal++ });
  await assert.rejects(browser.run(()=>new Promise(()=>{})), {code:'JOB_BROWSER_OPERATION_TIMEOUT'});
  assert.equal(fatal,1);
});
