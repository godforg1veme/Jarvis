const test = require('node:test');
const assert = require('node:assert/strict');
const { closeGuardedPage } = require('../src/pageCleanup');

test('page cleanup stops requests before close', async () => {
  const calls = [];
  await closeGuardedPage({ isClosed: () => false, evaluate: async fn => { assert.equal(typeof fn, 'function'); calls.push('stop'); },
    close: async () => { calls.push('close'); } });
  assert.deepEqual(calls, ['stop', 'close']);
});

test('failed stop still closes page, reports closed code and marks runtime unhealthy', async () => {
  const calls = [];
  await assert.rejects(closeGuardedPage({ isClosed: () => false, evaluate: async () => { throw Error('PRIVATE'); },
    close: async () => { calls.push('close'); } }, { onUnhealthy: () => calls.push('unhealthy') }),
  { code: 'JOB_BROWSER_PAGE_CLEANUP_FAILED' });
  assert.deepEqual(calls, ['close', 'unhealthy']);
});

test('stalled stop is bounded and close is still attempted', async () => {
  let closed = false, unhealthy = 0;
  await assert.rejects(closeGuardedPage({ evaluate: () => new Promise(() => {}), close: async () => { closed = true; } },
    { timeoutMs: 10, onUnhealthy: () => unhealthy++ }), { code: 'JOB_BROWSER_PAGE_CLEANUP_FAILED' });
  assert.equal(closed, true); assert.equal(unhealthy, 1);
});

test('crashed or already closed page skips stop and attempts close', async () => {
  let closed = false;
  await closeGuardedPage({ isClosed: () => true, close: async () => { closed = true; } });
  assert.equal(closed, true);
});
