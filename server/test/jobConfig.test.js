const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config/loadConfig');

test('job search is disabled by default without a separate model setting', () => {
  const config = loadConfig({ NODE_ENV: 'test' });
  assert.equal(config.jobSearchEnabled, false);
  assert.equal(config.jobCollectorIntervalMs, 1800000);
  assert.equal(config.jobHistoryDays, 14);
  assert.equal(config.jobBudgetUsd, 3);
  assert.equal(Object.hasOwn(config,'jobSearchModel'),false);
});

test('job configuration validates interval, budget, public origin and encryption key', () => {
  for (const env of [
    { JARVIS_JOB_COLLECTOR_INTERVAL_MS: '-1' }, { JARVIS_JOB_BUDGET_USD: 'NaN' },
    { JARVIS_JOB_HISTORY_DAYS: '0' }, { JARVIS_JOB_SECRET_KEY: 'invalid' },
    { NODE_ENV: 'test', JARVIS_JOB_PUBLIC_ORIGIN: 'https://example.org/private/path' },
  ]) assert.throws(() => loadConfig({ NODE_ENV: 'test', ...env }));
  const config = loadConfig({ NODE_ENV: 'test', JARVIS_JOB_SEARCH_ENABLED: 'true',
    JARVIS_JOB_MODEL: 'candidate-model', JARVIS_JOB_SECRET_KEY: '01'.repeat(32) });
  assert.equal(Object.hasOwn(config,'jobSearchModel'),false);
  assert.equal(config.jobSearchEnabled, true);
});
