const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { createResourceCloser } = require('../src/lifecycle');

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('every close is attempted, sync/rejected failures are safe and close is idempotent', async () => {
  for (const failing of ['job', 'worker', 'telegram', 'http', 'database']) {
    const events = [];
    const entry = (name) => ({ name, close() {
      events.push(name);
      if (name === failing) {
        if (name === 'worker') throw new Error('sensitive-fixture-detail');
        return Promise.reject(new Error('sensitive-fixture-detail'));
      }
    } });
    const close = createResourceCloser(['job', 'worker', 'telegram', 'http'].map(entry), { final: [entry('database')] });
    const first = close();
    assert.equal(close(), first);
    await assert.rejects(first, (error) => {
      assert.equal(error.code, 'RUNTIME_CLOSE_FAILED');
      assert.deepEqual(error.failures, [{ resource: failing, code: 'RESOURCE_CLOSE_FAILED' }]);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /sensitive-fixture-detail/);
      return true;
    });
    assert.deepEqual(events, ['job', 'worker', 'telegram', 'http', 'database']);
    await close().catch(() => {});
    assert.equal(events.length, 5);
  }
});

test('all admissions stop before awaiting drains; pool follows all admitted work', async () => {
  const a = deferred(), b = deferred();
  const events = [];
  const close = createResourceCloser([
    { name: 'a', close() { events.push('stop-a'); return a.promise; } },
    { name: 'b', close() { events.push('stop-b'); return b.promise; } },
  ], { final: [{ name: 'database', close() { events.push('pool'); } }] });
  const closing = close();
  assert.deepEqual(events, ['stop-a', 'stop-b']);
  a.resolve();
  await turn();
  assert.equal(events.includes('pool'), false);
  b.resolve();
  await closing;
  assert.equal(events.at(-1), 'pool');
});

test('nested runtimes share one deadline, attempt pool once and do not wait N budgets', async () => {
  const deadlines = [];
  let pool = 0;
  const inner = createResourceCloser([{ name: 'hung-inner', close() { return new Promise(() => {}); } }]);
  const resources = Array.from({ length: 8 }, (_, index) => ({ name: `worker${index}`, close(deadline) {
    deadlines.push(deadline);
    return index === 0 ? inner({ deadline }) : new Promise(() => {});
  } }));
  const close = createResourceCloser(resources, { timeoutMs: 25, final: [{ name: 'database', close() { pool++; } }] });
  const started = Date.now();
  await assert.rejects(close(), (error) => error.failures.length === 8);
  assert.equal(new Set(deadlines).size, 1);
  assert.equal(pool, 1);
  assert.ok(Date.now() - started < 150, 'deadline must not multiply by worker count');
});

const workerSpecs = [
  ['CommandWorker', '../src/commands/commandWorker', 'runOnce'],
  ['KnowledgeWorker', '../src/knowledge/knowledgeService', 'runOnce'],
  ['VisualMemoryWorker', '../src/vision/visualMemoryService', 'runOnce'],
  ['LifeProjectionWorker', '../src/life/lifeProjectionWorker', 'tick'],
  ['ProactivityWorker', '../src/life/proactivityWorker', 'tick'],
  ['ReminderWorker', '../src/life/reminders/reminderWorker', 'tick'],
  ['VpnRecoveryWorker', '../src/vpn/vpnRecoveryWorker', 'tick'],
  ['CollectorWorker', '../src/operations/collectors/collectorWorker', 'runOnce'],
  ['HealthCheckWorker', '../src/operations/collectors/healthCheckWorker', 'runOnce'],
  ['LogCollector', '../src/operations/collectors/logCollector', 'runOnce'],
  ['RollupWorker', '../src/operations/collectors/rollupWorker', 'runOnce'],
  ['RetentionWorker', '../src/operations/collectors/retentionWorker', 'runOnce'],
  ['OperationRecoveryWorker', '../src/operations/actions/operationRecoveryWorker', 'runOnce'],
  ['JobDeliveryWorker', '../src/jobs/jobDeliveryWorker', 'tick'],
  ['JobCaptchaWorker', '../src/jobs/jobCaptchaWorker', 'tick'],
  ['JobHistoryWorker', '../src/jobs/jobHistoryWorker', 'tick'],
  ['JobRecoveryWorker', '../src/jobs/jobRecovery', 'tick'],
];
for (const [name, modulePath, task] of workerSpecs) {
  test(`${name} stop drains admitted task, blocks new ticks and clears timer synchronously`, async () => {
    const gate = deferred();
    let calls = 0;
    const hold = () => { calls++; return gate.promise; };
    const repository = new Proxy({}, { get: () => hold });
    const Worker = require(modulePath)[name];
    const worker = new Worker({ repository, eventRepository: repository, projectionRepository: repository,
      deliveryRepository: repository, searchRepository: repository, applicationRepository: repository,
      pool: { query: hold }, client: { request: hold }, service: { reconcile: hold, cleanupExpired: hold },
      logger: { warn() {}, info() {} }, report() {} });
    const work = worker[task]();
    assert.ok(calls > 0, 'actual worker task must have entered its dependency');
    worker.timer = setInterval(() => {}, 1000);
    const stopped = worker.stop();
    assert.equal(worker.timer, null);
    assert.equal(worker.stop(), stopped);
    let drained = false;
    stopped.then(() => { drained = true; }, () => { drained = true; });
    const before = calls;
    await worker[task]();
    await turn();
    assert.equal(calls, before);
    assert.equal(drained, false);
    gate.reject(new Error('controlled-dependency-failure'));
    await Promise.allSettled([work, stopped]);
    assert.equal(drained, true);
    await worker[task]();
    assert.equal(worker.timer, null);
  });
}

test('JobRecoveryWorker stop during async start cannot resurrect its timer', async () => {
  const { JobRecoveryWorker } = require('../src/jobs/jobRecovery');
  const gate = deferred();
  const worker = new JobRecoveryWorker({ applicationRepository: { recoverSending: () => gate.promise },
    pool: { async connect() { return { async query() { return { rows: [] }; }, release() {} }; } } });
  const starting = worker.start();
  const stopped = worker.stop();
  gate.resolve();
  await Promise.all([starting, stopped]);
  assert.equal(worker.timer, null);
});

test('admitted projection mutation finishes once with its original claim before drain resolves', async () => {
  const { LifeProjectionWorker } = require('../src/life/lifeProjectionWorker');
  const gate = deferred();
  let claimed = 0;
  const processed = [];
  const worker = new LifeProjectionWorker({
    eventRepository: {
      async claimPending() { claimed++; return { events: [{ id: 'event', user_id: 'owner' }], claimToken: 'original-claim' }; },
      async markProcessed(value) { processed.push(value); },
    }, projectionRepository: {}, enrich: () => gate.promise,
  });
  const work = worker.tick();
  await turn();
  const stopped = worker.stop();
  await worker.tick();
  assert.equal(processed.length, 0);
  gate.resolve();
  await Promise.all([work, stopped]);
  assert.equal(claimed, 1);
  assert.deepEqual(processed, [{ userId: 'owner', eventId: 'event', claimToken: 'original-claim' }]);
});

test('bounded close leaves no worker interval or timeout keeping an idle process alive', () => {
  const script = `
    const { CommandWorker } = require('./server/src/commands/commandWorker');
    const { createResourceCloser } = require('./server/src/lifecycle');
    const worker = new CommandWorker({ repository: { expireStale: () => new Promise(() => {}) } });
    worker.start();
    const close = createResourceCloser([{ name: 'worker', close: () => worker.stop() }], { timeoutMs: 10 });
    close().catch(e => { if(e.code !== 'RUNTIME_CLOSE_FAILED') process.exitCode=2; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '../..'), timeout: 2000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
});
