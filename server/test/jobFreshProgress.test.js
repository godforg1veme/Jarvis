const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshFreshProgress, boundFreshProgress } = require('../src/jobs/jobFreshProgress');
const { JobCollector } = require('../src/jobs/jobCollector');

test('head refresh preserves partial offsets, stable run identity and the next unfinished query priority', () => {
  const until = '2026-10-25T12:00:00.000Z';
  const partial = { query: 'second', from: '2026-10-25T11:00:00.000Z', to: until, page: 2, offset: 3 };
  const progress = { until, lower: partial.from, windows: [partial] };
  refreshFreshProgress(progress, ['first', 'second'], new Date('2026-10-25T12:04:59.999Z'));
  assert.deepEqual(progress.windows, [partial]);
  refreshFreshProgress(progress, ['first', 'second'], new Date('2026-10-25T12:05:00.000Z'));
  assert.equal(progress.until, until); assert.equal(progress.windows[0].query, 'second');
  assert.deepEqual(progress.windows.at(-1), partial);
});

test('long-running partial heads compact to conservative query unions without dropping any unchecked interval', () => {
  const progress = { until: '2026-10-25T12:00:00.000Z', lower: '2026-10-25T11:00:00.000Z', windows: [] };
  const original = [];
  for (let index = 0; index < 300; index++) {
    const window = { query: `query-${index % 3}`, from: new Date(Date.parse(progress.lower) + index * 60000).toISOString(),
      to: new Date(Date.parse(progress.lower) + (index + 5) * 60000).toISOString(), page: 1, offset: 7 };
    progress.windows.push(window); original.push({ ...window });
  }
  const identity = progress.until;
  boundFreshProgress(progress);
  assert.equal(progress.windows.length, 3); assert.equal(progress.until, identity);
  assert.ok(Buffer.byteLength(JSON.stringify(progress)) < 96 * 1024);
  for (const window of original) {
    const union = progress.windows.find(candidate => candidate.query === window.query);
    assert.ok(union.from <= window.from && union.to >= window.to);
    assert.equal(union.page, 0); assert.equal(union.offset, 0);
  }
});

test('repeated five-minute heads remain bounded even when each pass leaves a partial cursor', () => {
  const start = Date.parse('2026-10-25T12:00:00.000Z');
  const progress = { until: new Date(start).toISOString(), lower: new Date(start - 3600000).toISOString(), windows: [] };
  const queries = Array.from({ length: 100 }, (_, index) => `${index}-${'ф'.repeat(190)}`);
  for (let pass = 1; pass <= 1000; pass++) {
    refreshFreshProgress(progress, queries, new Date(start + pass * 300000));
    boundFreshProgress(progress);
    const window = progress.windows[0]; window.page = 1; window.offset = 1;
    assert.ok(Buffer.byteLength(JSON.stringify(progress)) < 128 * 1024);
  }
  assert.equal(progress.until, new Date(start).toISOString());
  assert.equal(progress.lower, new Date(start - 3600000).toISOString());
});

test('a rejected progress size is not saved twice and releases the lease through normal failure handling', async () => {
  const now = new Date('2026-10-25T12:00:00.000Z');
  let saves = 0, finished;
  const searchRepository = {
    async claimSearch() { return { settings: { queries: ['Fixture'], intervalMs: 1800000, historyDays: 14 }, lease_id: 'fixture' }; },
    async saveProgress() { saves++; throw Object.assign(Error('fixture'), { code: 'JOB_COLLECTION_LIMIT' }); },
    async finishSearch(args) { finished = args; },
  };
  const result = await new JobCollector({ searchRepository, deliveryRepository: {}, hhClient: {},
    lane: 'fresh', now: () => now }).runOnce({ userId: 'fixture', now });
  assert.equal(result.outcome, 'JOB_COLLECTION_FAILED'); assert.equal(saves, 1);
  assert.equal(finished.leaseId, 'fixture'); assert.equal(finished.checkpoint, null);
  assert.equal(finished.failureCode, 'JOB_COLLECTION_FAILED');
});
