const test = require('node:test');
const assert = require('node:assert/strict');
const { recordReconciliationGap } = require('../src/jobs/jobReconciliationProgress');
const { calendarSearchFrom } = require('../src/jobs/jobCollectionWindows');

test('3000 saturated days retain compact per-query gap coverage instead of growing pending windows', () => {
  const progress = { until: '2026-10-26T12:00:00.000Z', lower: '2026-09-26T12:00:00.000Z', windows: [] };
  const gaps = [];
  for (let query = 0; query < 100; query++) {
    for (let day = 0; day < 30; day++) {
      const window = { query: `${query}-${'ф'.repeat(190)}`, from: new Date(Date.parse(progress.lower) + day * 86400000).toISOString(),
        to: new Date(Date.parse(progress.lower) + (day + 1) * 86400000).toISOString() };
      gaps.push({ ...window, queryIndex: query }); recordReconciliationGap(progress, window, 'JOB_COLLECTION_WINDOW_SATURATED', query);
    }
  }
  assert.equal(progress.gaps.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(progress)) < 96 * 1024);
  for (const original of gaps) {
    const summary = progress.gaps.find(gap => gap.queryIndex === original.queryIndex);
    assert.ok(summary.from <= original.from && summary.to >= original.to);
    assert.deepEqual(summary.codes, ['JOB_COLLECTION_WINDOW_SATURATED']);
  }
  assert.equal(progress.checkpoint, undefined);
});

test('gap summaries and pending windows together fit the storage budget for 100 maximum-width UTF-8 queries', () => {
  const progress = { until: '2026-10-26T12:00:00.000Z', lower: '2026-09-26T12:00:00.000Z', windows: [] };
  for (let index = 0; index < 100; index++) {
    const window = { query: `${index}-${'漢'.repeat(196)}`, from: progress.lower, to: progress.until, page: 1, offset: 7 };
    progress.windows.push(window);
    recordReconciliationGap(progress, window, 'JOB_COLLECTION_WINDOW_SATURATED', index);
    recordReconciliationGap(progress, window, 'JOB_HH_DOM_CHANGED', index);
    recordReconciliationGap(progress, window, 'JOB_COLLECTION_WINDOW_EXPIRED', index);
  }
  assert.equal(progress.gaps.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(progress)) < 96 * 1024);
});

test('calendar transport keeps the oldest Moscow date while giving the 30-day age guard time to read', () => {
  const now = new Date('2026-10-26T12:00:00.000Z');
  const window = { from: '2026-09-26T12:00:00.000Z', to: now.toISOString() };
  const requested = calendarSearchFrom(window, now);
  assert.equal(requested, '2026-09-26T20:59:59.999Z');
  assert.ok(now.getTime() + 60000 - Date.parse(requested) < 30 * 86400000);
  assert.equal(window.from, '2026-09-26T12:00:00.000Z', 'exact lower bound is unchanged');
  assert.equal(calendarSearchFrom({ from: window.from, to: '2026-09-26T13:00:00.000Z' }, now), '2026-09-26T13:00:00.000Z');
  assert.equal(calendarSearchFrom({ from: '2026-10-12T12:00:00.000Z', to: now.toISOString() }, now), '2026-10-12T12:00:00.000Z');
});
