const test = require('node:test');
const assert = require('node:assert/strict');
const { splitWindow } = require('../src/jobs/jobCollectionWindows');
const { JobCollector } = require('../src/jobs/jobCollector');

test('Moscow day split uses one exact midnight without overlap', () => {
  const parent = { query: 'AI', from: '2026-10-20T21:00:00.000Z', to: '2026-10-22T20:59:59.999Z', page: 0, offset: 0 };
  const [older, newer] = splitWindow(parent, 'moscow_day');
  assert.equal(older.to, '2026-10-21T20:59:59.999Z');
  assert.equal(newer.from, '2026-10-21T21:00:00.000Z');
  assert.equal(Date.parse(newer.from) - Date.parse(older.to), 1);
  assert.equal(splitWindow(older, 'moscow_day'), null);
  assert.equal(splitWindow(newer, 'moscow_day'), null);
});

test('legacy listing cursors restart within their original range before calendar searches', async () => {
  const until = '2026-10-22T12:00:00.000Z', lower = '2026-10-21T21:00:00.000Z';
  let progress = { until, lower, windows: [{ query: 'Fixture', from: lower, to: until, page: 7, offset: 2 }] };
  const reads = []; let checkpoint;
  const searchRepository = {
    async claimSearch() { return { settings: { queries: ['Fixture'], intervalMs: 1800000 }, progress, lease_id: 'fixture', revision: 1 }; },
    async renewSearch() { return true; }, async saveProgress({ progress: saved }) { progress = structuredClone(saved); },
    async finishSearch(value) { checkpoint = value.checkpoint; },
  };
  const hhClient = { capabilities: { dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 },
    async search(args) { assert.equal(args.page, 0); assert.equal(args.publishedFrom, lower); assert.equal(args.publishedTo, until);
      return { found: 3, pages: 1, items: ['10', '11', '12'].map(id => ({ id })) }; },
    async getVacancy({ externalId }) { reads.push(externalId); return { archived: true }; },
  };
  const result = await new JobCollector({ searchRepository, deliveryRepository: {}, hhClient,
    now: () => new Date(until), wait: async () => {} }).runOnce({ userId: 'fixture' });
  assert.equal(result.outcome, 'complete'); assert.deepEqual(reads, ['10', '11', '12']);
  assert.equal(checkpoint, until); assert.equal(progress.windowFormat, 'hh_calendar_v1'); assert.equal(progress.lower, lower);
});

test('generic sources retain bounded time splitting', () => {
  const parent = { query: 'AI', from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T02:00:00.000Z' };
  const children = splitWindow(parent);
  assert.equal(children.length, 2);
  assert.equal(Date.parse(children[1].from) - Date.parse(children[0].to), 1);
});

test('saturated day leaves its original window pending while another query completes', async () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const day = { query: 'broad', from: '2026-10-21T21:00:00.000Z', to: '2026-10-22T12:00:00.000Z', page: 0, offset: 0 };
  const other = { query: 'narrow', from: day.from, to: day.to, page: 0, offset: 0 };
  let progress = { lower: day.from, until: day.to, windows: [day, other] };
  const searched = [];
  let finish;
  const searchRepository = {
    async claimSearch() { return { settings: { queries: ['broad', 'narrow'], intervalMs: 1800000 },
      progress, lease_id: 'lease', revision: 1 }; },
    async renewSearch() { return true; },
    async saveProgress({ progress: value }) { progress = structuredClone(value); },
    async finishSearch(value) { finish = value; },
  };
  const hh = { capabilities: { dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 },
    async search({ query }) { searched.push(query); return query === 'broad'
      ? { found: 2001, pages: 101, items: [{ id: '1' }] }
      : { found: 0, pages: 0, items: [] }; } };
  const result = await new JobCollector({ searchRepository, deliveryRepository: {}, hhClient: hh,
    now: () => now, wait: async () => {} }).runOnce({ userId: 'user', now });
  assert.equal(result.outcome, 'JOB_COLLECTION_WINDOW_SATURATED');
  assert.deepEqual(searched, ['broad', 'narrow']);
  assert.equal(progress.windows.length, 1);
  assert.equal(progress.windows[0].query, 'broad');
  assert.equal(finish.checkpoint, null);
});

for (const mode of ['requests', 'slow_detail', 'slow_search']) test(`${mode} budget yields, rotates queries and keeps checkpoint open`, async () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const windows = ['first', 'second'].map((query) => ({ query, from: '2026-10-22T00:00:00Z',
    to: now.toISOString(), page: 0, offset: 0 }));
  let progress = { lower: windows[0].from, until: now.toISOString(), windows };
  let finish;
  const searchRepository = {
    async claimSearch() { return { settings: { queries: ['first', 'second'], intervalMs: 1800000 },
      progress, lease_id: 'lease', revision: 1 }; },
    async renewSearch() { return true; },
    async saveProgress({ progress: value }) { progress = structuredClone(value); },
    async finishSearch(value) { finish = value; },
  };
  let elapsed = 0;
  const hh = { async search() { if (mode === 'slow_search') elapsed = 60000;
    return { found: 2, pages: 1, items: [{ id: '1' }, { id: '2' }] }; },
    async getVacancy() { if (mode === 'slow_detail') elapsed = 60000; return { archived: true }; } };
  const result = await new JobCollector({ searchRepository, deliveryRepository: {}, hhClient: hh,
    now: () => new Date(now.getTime() + elapsed), wait: async () => {}, maxRequests: mode === 'requests' ? 2 : 40 }).runOnce({ userId: 'user', now });
  assert.equal(result.outcome, 'JOB_COLLECTION_LIMIT');
  assert.equal(progress.windows[0].query, 'second');
  assert.equal(progress.windows[1].offset, 1);
  assert.equal(finish.failureCode, null);
  assert.equal(finish.nextCheckAt.getTime(), now.getTime() + elapsed + 10000);
});

test('saturated day notifies before a later window exhausts the request budget', async () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const windows = ['broad', 'narrow'].map((query) => ({ query, from: '2026-10-21T21:00:00.000Z',
    to: now.toISOString(), page: 0, offset: 0 }));
  let progress = { lower: windows[0].from, until: now.toISOString(), windows };
  let finish;
  const notices = [];
  const noticeKeys = new Set();
  const searchRepository = {
    async claimSearch() { return { settings: { queries: ['broad', 'narrow'], intervalMs: 1800000 },
      progress, lease_id: 'lease', revision: 1 }; },
    async renewSearch() { return true; },
    async saveProgress({ progress: value }) { progress = structuredClone(value); },
    async finishSearch(value) { finish = value; },
  };
  const hh = { capabilities: { dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 },
    async search({ query }) { return query === 'broad'
      ? { found: 2001, pages: 101, items: [{ id: '1' }] }
      : { found: 1, pages: 1, items: [{ id: '2' }] }; },
    async getVacancy() { return { archived: true }; } };
  const run = () => new JobCollector({ searchRepository,
    deliveryRepository: { async enqueueCollectionAttention(value) {
      const key = `${value.userId}:${value.runUntil}`;
      if (!noticeKeys.has(key)) { noticeKeys.add(key); notices.push(value); }
    } }, hhClient: hh,
    now: () => now, wait: async () => {}, maxRequests: 2 }).runOnce({ userId: 'user', now });
  const result = await run();
  assert.equal(result.outcome, 'JOB_COLLECTION_LIMIT');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].code, 'JOB_COLLECTION_WINDOW_SATURATED');
  assert.equal(notices[0].runUntil, now.toISOString());
  assert.equal(finish.failureCode, null);
  assert.equal(finish.checkpoint, null);
  assert.equal(progress.windows.length, 2);
  assert.equal((await run()).outcome, 'JOB_COLLECTION_LIMIT');
  assert.equal(notices.length, 1);
});
