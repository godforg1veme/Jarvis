const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CaptchaTelegramBrowser } = require('../src/captchaTelegramBrowser');
const target = 'https://hh.ru/vacancy/123';
function fixture() {
  let opened = 0, closed = 0;
  const old = new EventEmitter(); old.isClosed = () => false; old.close = async () => { closed++; };
  const fresh = new EventEmitter(); fresh.isClosed = () => false; fresh.goto = async () => { opened++; }; fresh.close = async () => {};
  const coordinator = { status: () => ({ phase: 'active', revision: 4 }) };
  const ctrl = new CaptchaTelegramBrowser({ context: { newPage: async () => fresh }, coordinator, now: () => 1000 });
  ctrl.page = old; return { ctrl, old, fresh, counts: () => ({ opened, closed }) };
}
test('opening CAPTCHA replaces old or crashed page rather than navigating it forever', async () => {
  const f = fixture(); await f.ctrl.open(target);
  assert.equal(f.ctrl.page, f.fresh); assert.deepEqual(f.counts(), { opened: 1, closed: 1 });
});
test('used, expired and unavailable issued pictures explicitly require refresh without any navigation', async () => {
  for (const change of [{ used: true }, { expires: 999 }, { revision: 3 }]) {
    const f = fixture(); f.ctrl.current = { used: false, expires: 2000, revision: 4, ...change };
    assert.deepEqual(await f.ctrl.challenge(false), { outcome: 'refresh_required' }); assert.equal(f.counts().opened, 0);
  }
});
test('a stuck page close requests runtime recovery instead of accumulating orphan tabs', async () => {
  const f = fixture(); let fatal = 0;
  f.old.close = () => new Promise(() => {}); f.ctrl.closeTimeoutMs = 20; f.ctrl.onUnhealthy = () => fatal++;
  await assert.rejects(f.ctrl.open(target), { code: 'JOB_BROWSER_OPERATION_TIMEOUT' });
  assert.equal(fatal, 1); assert.equal(f.counts().opened, 0);
});
