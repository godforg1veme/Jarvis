const test = require('node:test');
const assert = require('node:assert/strict');
const { JobCollectionScheduler } = require('../src/jobs/jobCollectionScheduler');

function fixture({ fresh = ['a', 'b'], history = ['a', 'b'], elapsed = 1000, fail = null } = {}) {
  let time = 0, stopped = false;
  const calls = [], errors = [], due = { fresh, history };
  const components = {};
  for (const lane of ['fresh', 'history']) {
    components[`${lane}Repository`] = { async dueUsers({ limit }) {
      return due[lane].slice(0, limit).map(user_id => ({ user_id }));
    } };
    components[`${lane}Collector`] = { async runOnce({ userId }) {
      calls.push(`${lane}:${userId}`); time += elapsed;
      if (fail === `${lane}:${userId}`) throw Error('synthetic failure');
    } };
  }
  return { calls, errors, due, stop() { stopped = true; }, components,
    create(options = {}) { return new JobCollectionScheduler({ ...components, now: () => new Date(time),
      shouldStop: () => stopped, onFailure: () => errors.push('closed failure'), ...options }); } };
}

test('fresh work alternates with history, once per user per lane in one bounded tick', async () => {
  const f = fixture();
  await f.create().tick();
  assert.deepEqual(f.calls, ['fresh:a', 'history:a', 'fresh:b', 'history:b']);
});

test('fresh work is queried again after a history pass, including new arrivals', async () => {
  const f = fixture({ fresh: [], history: ['a', 'b'] });
  f.components.historyCollector.runOnce = async ({ userId }) => {
    f.calls.push(`history:${userId}`); f.due.fresh.push('arrived');
  };
  await f.create().tick();
  assert.deepEqual(f.calls, ['history:a', 'fresh:arrived', 'history:b']);
});

test('one failed user does not block either lane or another user', async () => {
  const f = fixture({ fail: 'fresh:a' });
  await f.create().tick();
  assert.deepEqual(f.calls, ['fresh:a', 'history:a', 'fresh:b', 'history:b']);
  assert.equal(f.errors.length, 1);
});

test('time budget and stop prevent starting the next pass', async () => {
  const f = fixture({ elapsed: 16000 });
  await f.create({ maxTickMs: 30000 }).tick();
  assert.deepEqual(f.calls, ['fresh:a', 'history:a']);
  f.calls.length = 0; f.stop();
  await f.create().tick(); assert.deepEqual(f.calls, []);
});

test('fresh-only and history-only workloads both progress with a capped batch', async () => {
  for (const lane of ['fresh', 'history']) {
    const f = fixture({ fresh: [], history: [], elapsed: 0 });
    f.due[lane].push('1', '2', '3', '4', '5');
    await f.create().tick();
    assert.deepEqual(f.calls, ['1', '2', '3', '4'].map(id => `${lane}:${id}`));
  }
});

test('users beyond the first batch progress before recently served users become due again', async () => {
  let time = 0;
  const served = [];
  const users = Array.from({ length: 9 }, (_, index) => ({ user_id: String(index), due: -1000 }));
  const scheduler = new JobCollectionScheduler({ now: () => new Date(time),
    freshRepository: { async dueUsers({ limit }) { return users.filter(user => user.due <= time)
      .sort((a, b) => a.due - b.due).slice(0, limit); } },
    historyRepository: { async dueUsers() { return []; } },
    freshCollector: { async runOnce({ userId }) { served.push(userId); users.find(user => user.user_id === userId).due = time + 10000; } },
    historyCollector: {},
  });
  await scheduler.tick(); time += 10000;
  await scheduler.tick(); time += 10000;
  await scheduler.tick();
  assert.deepEqual(served.slice(0, 9), users.map(user => user.user_id));
});

test('daily reconciliation alternates with historical passes while fresh work gets the next check', async () => {
  const f = fixture({ fresh: ['a', 'b', 'c'], history: ['a', 'b'] });
  f.components.reconcileRepository = { async dueUsers() { return [{ user_id: 'a' }, { user_id: 'b' }]; } };
  f.components.reconcileCollector = { async runOnce({ userId }) { f.calls.push(`reconcile:${userId}`); } };
  await f.create().tick();
  assert.deepEqual(f.calls, ['fresh:a', 'history:a', 'fresh:b', 'reconcile:a', 'fresh:c', 'history:b', 'reconcile:b']);
});

test('a slow fresh pass cannot starve background work across ticks', async () => {
  const f = fixture({ fresh: ['a'], history: ['a'], elapsed: 70000 });
  const scheduler = f.create();
  await scheduler.tick(); assert.deepEqual(f.calls, ['fresh:a']);
  await scheduler.tick(); assert.deepEqual(f.calls, ['fresh:a', 'history:a']);
});

test('limited ticks retain the next background lane so reconciliation does not starve behind history', async () => {
  const f = fixture({ fresh: [], history: ['a'], elapsed: 70000 });
  f.components.reconcileRepository = { async dueUsers() { return [{ user_id: 'a' }]; } };
  f.components.reconcileCollector = { async runOnce({ userId }) { f.calls.push(`reconcile:${userId}`); } };
  const scheduler = f.create();
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(f.calls.slice(0, 2), ['history:a', 'reconcile:a']);
});
