const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobRuntime } = require('../src/jobs/jobRuntime');
const { createCollectorRuntime } = require('../src/jobs/collectorMain');
const { settingsSchema, parseJobSettings, defaultJobSettings } = require('../src/jobs/jobSchemas');
const { JobCollector } = require('../src/jobs/jobCollector');

test('empty settings validate and a claimed empty search makes no HH request', async () => {
  assert.deepEqual(settingsSchema.parse(defaultJobSettings()).queries, []);
  assert.equal(settingsSchema.parse({ ...defaultJobSettings(), queries: ['инженер'], targetRub: 100000,
    officeCity: 'Москва', remote: true }).remote, true);
  assert.deepEqual({ activated: parseJobSettings({ ...defaultJobSettings(), activated: true }).activated,
    paused: parseJobSettings({ ...defaultJobSettings(), activated: true }).paused },
  { activated: false, paused: true });
  let called = false;
  const collector = new JobCollector({
    searchRepository: { async claimSearch() { return { settings: defaultJobSettings(), lease_id: 'lease' }; },
      async finishSearch({ failureCode }) { assert.equal(failureCode, 'JOB_SEARCH_QUERIES_REQUIRED'); called = true; } },
    deliveryRepository: {}, hhClient: { async search() { throw new Error('HH must not be called'); } },
  });
  assert.deepEqual(await collector.runOnce({ userId: '11111111-1111-4111-8111-111111111111' }),
    { outcome: 'JOB_SEARCH_QUERIES_REQUIRED', matched: 0, requests: 0 });
  assert.equal(called, true);
});

test('feature off constructs no database, model or Telegram worker', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Unexpected feature access'); } });
  assert.equal(createJobRuntime({ config: { jobSearchEnabled: false }, pool: forbidden }), null);
  const runtime = createCollectorRuntime({ env: {}, pool: forbidden });
  assert.equal(runtime.enabled, false); await runtime.start(); await runtime.close();
});

test('collector has independent configuration and never requires a Telegram or model key', async () => {
  const queries = [];
  const pool = { async query(sql) { queries.push(sql); return { rows: [], rowCount: 0 }; } };
  const runtime = createCollectorRuntime({ env: { JARVIS_JOB_SEARCH_ENABLED: 'true', JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: '101' }, pool, hhClient: {} });
  assert.equal(runtime.enabled, true);
  await runtime.start(); await runtime.close();
  assert.equal(queries.length, 2);
  assert.match(queries[0], /job_searches/);
  assert.ok(!queries.some((sql) => /telegram_updates|job_usage/.test(sql)));
});

test('enabled collector rejects missing or invalid owner configuration instead of silently skipping searches', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Unexpected database access'); } });
  for (const owner of [undefined, '', '0', '-1', 'username', '1'.repeat(21)]) {
    assert.throws(() => createCollectorRuntime({
      env: { JARVIS_JOB_SEARCH_ENABLED: 'true', JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: owner }, pool: forbidden, hhClient: {},
    }), /JOB_COLLECTOR_OWNER_CONFIG_INVALID/);
  }
});

test('collector Compose configuration forwards the same owner setting as the server', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const compose = fs.readFileSync(path.join(__dirname, '../../deploy/docker-compose.yml'), 'utf8');
  const collector = compose.split(/^  job-collector:\s*$/m)[1].split(/^  postgres:\s*$/m)[0];
  assert.match(collector, /JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: \$\{JARVIS_OPERATIONS_OWNER_TELEGRAM_ID:-0\}/);
});

test('due users skips revoked permissions but propagates database errors', async () => {
  const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
  const userId = '11111111-1111-4111-8111-111111111111';
  const pool = { async query() { return { rows: [{ user_id: userId }] }; } };
  let failure = Object.assign(new Error('denied'), { code: 'JOB_SCOPE_DENIED' });
  const repository = new JobSearchRepository(pool, { accessService: { repository: { async get() { throw failure; } } } });
  assert.deepEqual(await repository.dueUsers(), []);
  failure = Object.assign(new Error('fixture connection lost'), { code: '08006' });
  await assert.rejects(repository.dueUsers(), { code: '08006' });
});
