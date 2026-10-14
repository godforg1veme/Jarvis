const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobRuntime } = require('../src/jobs/jobRuntime');
const { createCollectorRuntime } = require('../src/jobs/collectorMain');

test('feature off constructs no database, model or Telegram worker', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Unexpected feature access'); } });
  assert.equal(createJobRuntime({ config: { jobSearchEnabled: false }, pool: forbidden }), null);
  const runtime = createCollectorRuntime({ env: {}, pool: forbidden });
  assert.equal(runtime.enabled, false); await runtime.start(); await runtime.close();
});

test('collector has independent configuration and never requires a Telegram or model key', async () => {
  const queries = [];
  const pool = { async query(sql) { queries.push(sql); return { rows: [], rowCount: 0 }; } };
  const runtime = createCollectorRuntime({ env: { JARVIS_JOB_SEARCH_ENABLED: 'true' }, pool });
  assert.equal(runtime.enabled, true);
  await runtime.start(); await runtime.close();
  assert.equal(queries.length, 2);
  assert.match(queries[0], /job_searches/);
  assert.ok(!queries.some((sql) => /telegram_updates|job_usage/.test(sql)));
});
