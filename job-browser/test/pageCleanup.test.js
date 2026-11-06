const test = require('node:test');
const assert = require('node:assert/strict');
const { closeGuardedPage } = require('../src/pageCleanup');

test('page cleanup leaves the document before closing its guarded target', async () => {
  const calls = [];
  await closeGuardedPage({ isClosed: () => false, url: () => 'about:blank', goto: async (url, options) => { assert.equal(url, 'about:blank'); assert.equal(options.waitUntil, 'load'); calls.push('blank'); },
    close: async () => { calls.push('close'); } });
  assert.deepEqual(calls, ['blank', 'close']);
});

test('failed blank navigation marks runtime unhealthy before any unsafe direct close', async () => {
  const calls = [];
  await assert.rejects(closeGuardedPage({ isClosed: () => false, goto: async () => { throw Error('PRIVATE'); },
    close: async () => { calls.push('close'); } }, { onUnhealthy: () => calls.push('unhealthy') }),
  { code: 'JOB_BROWSER_PAGE_CLEANUP_FAILED' });
  assert.deepEqual(calls, ['unhealthy']);
});

test('stalled blank navigation is bounded and never closes the live document directly', async () => {
  let closed = false, unhealthy = 0;
  await assert.rejects(closeGuardedPage({ goto: () => new Promise(() => {}), close: async () => { closed = true; } },
    { timeoutMs: 10, onUnhealthy: () => unhealthy++ }), { code: 'JOB_BROWSER_PAGE_CLEANUP_FAILED' });
  assert.equal(closed, false); assert.equal(unhealthy, 1);
});

test('crashed or already closed page skips stop and attempts close', async () => {
  let closed = false;
  await closeGuardedPage({ isClosed: () => true, close: async () => { closed = true; } });
  assert.equal(closed, true);
});
