const test = require('node:test');
const assert = require('node:assert/strict');
const { HhBrowser } = require('../src/hhBrowser');

function browser(options = {}) {
  return new HhBrowser({ context: { newPage() {} }, ...options });
}
async function until(predicate) {
  while (!predicate()) await new Promise(resolve => setImmediate(resolve));
}

test('queued vacancy work passes background history while preserving each class order', async () => {
  const hh = browser({ primaryResumeId: 'selected' });
  const order = [];
  let release;
  const active = hh.run(() => new Promise(resolve => { release = resolve; }));
  await until(() => release);
  hh.read = async url => {
    if (url.endsWith('/applicant/resumes')) return [{ id: 'selected' }];
    order.push(url.includes('/negotiations') ? 'history' : 'vacancy');
    return url;
  };
  const history = hh.history({ section: 'active', page: 0 });
  const vacancy = hh.getVacancy({ externalId: '123' });
  assert.equal(hh.activeOperations, 1);
  assert.equal(hh.isBusy(), true);
  release();
  await Promise.all([active, history, vacancy, hh.tail]);
  assert.deepEqual(order, ['vacancy', 'history']);
  assert.equal(hh.activeOperations, 0);
});

test('background history makes progress after four foreground operations', async () => {
  const hh = browser();
  let release;
  const active = hh.run(() => new Promise(resolve => { release = resolve; }));
  await until(() => release);
  const order = [];
  const background = [1, 2].map(id => hh.run(() => { order.push(`h${id}`); }, { background: true }));
  const foreground = Array.from({ length: 9 }, (_, i) => hh.run(() => { order.push(`v${i + 1}`); }));
  release();
  await Promise.all([active, ...background, ...foreground, hh.tail]);
  assert.deepEqual(order, ['v1', 'v2', 'v3', 'v4', 'h1', 'v5', 'v6', 'v7', 'v8', 'h2', 'v9']);
});

test('past foreground traffic gives no priority to a newly queued history request', async () => {
  const hh = browser();
  for (let i = 0; i < 6; i++) await hh.run(() => i);
  let release;
  const active = hh.run(() => new Promise(resolve => { release = resolve; }));
  await until(() => release);
  const order = [];
  const history = hh.run(() => { order.push('history'); }, { background: true });
  const vacancy = hh.run(() => { order.push('vacancy'); });
  release();
  await Promise.all([active, history, vacancy, hh.tail]);
  assert.deepEqual(order, ['vacancy', 'history']);
});

test('tail waits for history even after foreground work overtakes it', async () => {
  const hh = browser();
  let releaseActive, releaseHistory;
  const active = hh.run(() => new Promise(resolve => { releaseActive = resolve; }));
  await until(() => releaseActive);
  const history = hh.run(() => new Promise(resolve => { releaseHistory = resolve; }), { background: true });
  const foreground = hh.run(() => 'vacancy');
  let drained = false;
  hh.tail.then(() => { drained = true; });
  releaseActive();
  assert.equal(await foreground, 'vacancy');
  await until(() => releaseHistory);
  assert.equal(drained, false);
  releaseHistory();
  await Promise.all([active, history, hh.tail]);
  assert.equal(drained, true);
});

test('a rejected operation and timeout allow queued work to finish', async () => {
  const hh = browser({ operationTimeoutMs: 10 });
  const order = [];
  const rejected = hh.run(() => { order.push('fail'); throw Error('fixture'); });
  const next = hh.run(() => { order.push('next'); });
  await assert.rejects(rejected, /fixture/);
  await next;
  const timedOut = hh.run(() => new Promise(() => {}));
  const afterTimeout = hh.run(() => { order.push('after timeout'); });
  await assert.rejects(timedOut, { code: 'JOB_BROWSER_OPERATION_TIMEOUT' });
  await Promise.all([afterTimeout, hh.tail]);
  assert.deepEqual(order, ['fail', 'next', 'after timeout']);
  assert.equal(hh.activeOperations, 0);
});

test('each profile has its own queue and never runs two operations at once', async () => {
  const first = browser(), second = browser();
  let releaseFirst, releaseSecond;
  const activeFirst = first.run(() => new Promise(resolve => { releaseFirst = resolve; }));
  const activeSecond = second.run(() => new Promise(resolve => { releaseSecond = resolve; }));
  await until(() => releaseFirst && releaseSecond);
  let firstDone = false, secondDone = false;
  const queuedFirst = first.run(() => { firstDone = true; });
  const queuedSecond = second.run(() => { secondDone = true; });
  assert.equal(first.activeOperations, 1);
  assert.equal(second.activeOperations, 1);
  assert.equal(firstDone, false);
  assert.equal(secondDone, false);
  releaseFirst();
  await queuedFirst;
  assert.equal(firstDone, true);
  assert.equal(secondDone, false);
  releaseSecond();
  await Promise.all([activeFirst, activeSecond, queuedSecond, first.tail, second.tail]);
  assert.equal(secondDone, true);
});
