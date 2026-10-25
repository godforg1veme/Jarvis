const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const { JobCollector } = require('../src/jobs/jobCollector');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY = 86400000;
const oldVacancy = id => ({ externalId: id, title: 'Fixture engineer', company: 'Fixture',
  description: 'Engineering', publishedAt: '2026-10-20T12:00:00.000Z', city: 'Москва', workFormat: 'office' });

async function setup(queries = ['Fixture']) {
  const f = await createJobPostgresFixture();
  try {
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const history = new JobSearchRepository(f.pool, { accessService });
    const reconcile = new JobSearchRepository(f.pool, { accessService, lane: 'reconcile' });
    const delivery = new JobDeliveryRepository(f.pool, { accessService });
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const row = await history.ensure({ scope: f.scope });
    await history.saveSettings({ scope: f.scope, expectedRevision: row.revision,
      settings: { ...row.settings, queries, exclusions: ['Sales'], activated: true, paused: false } });
    return { f, accessService, history, reconcile, delivery,
      run(hhClient, { now = NOW, ...options } = {}) {
        return new JobCollector({ searchRepository: reconcile, deliveryRepository: delivery, hhClient,
          now: () => now, wait: async () => {}, lane: 'reconcile', ...options })
          .runOnce({ userId: f.owner, now, force: true });
      } };
  } catch (error) { await f.close(); throw error; }
}

test('daily full-range scan finds missed old vacancies outside both incremental overlaps and repeats the whole range', async () => {
  const s = await setup(); const ranges = [];
  const checkpoint = '2026-10-26T11:00:00.000Z';
  const progress = { lower: '2026-10-12T12:00:00.000Z', until: checkpoint,
    windows: [{ query: 'Fixture', from: '2026-10-12T12:00:00.000Z', to: checkpoint, page: 2, offset: 4 }] };
  let ids = ['1', '3'];
  const hh = { async search(args) { ranges.push(args); return { found: ids.length, pages: 1, items: ids.map(id => ({ id })) }; },
    async getVacancy({ externalId }) { return externalId === '3'
      ? { ...oldVacancy('3'), description: 'Sales' } : oldVacancy(externalId); } };
  try {
    await s.f.pool.query(`UPDATE job_searches SET checkpoint=$1,fresh_checkpoint=$1,reconciliation_checkpoint=$1,
      progress=$2,fresh_progress=$2 WHERE user_id=$3`, [checkpoint, progress, s.f.owner]);
    const result = await s.run(hh); assert.equal(result.outcome, 'complete'); assert.equal(result.matched, 1);
    assert.equal(ranges[0].publishedFrom, '2026-10-12T12:00:00.000Z');
    assert.equal(ranges[0].publishedTo, NOW.toISOString());
    let state = await s.history.getSettings({ userId: s.f.owner });
    assert.deepEqual(state.progress, progress); assert.deepEqual(state.fresh_progress, progress);
    assert.equal(state.checkpoint.toISOString(), checkpoint); assert.equal(state.fresh_checkpoint.toISOString(), checkpoint);
    assert.equal(state.reconciliation_checkpoint.toISOString(), NOW.toISOString());
    assert.equal(state.reconciliation_progress, null);
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-27T12:00:00.000Z');
    assert.deepEqual((await s.f.pool.query('SELECT priority FROM job_deliveries')).rows, [{ priority: 0 }]);
    const first = await s.delivery.claim(); await s.delivery.finish({ deliveryId: first.id, outcome: 'sent' });
    // HH indexes an old publication late. It lies far outside the one-hour overlap.
    ids = ['1', '2', '3'];
    const tomorrow = new Date(NOW.getTime() + DAY);
    assert.equal((await s.run(hh, { now: tomorrow })).outcome, 'complete');
    assert.equal(ranges[1].publishedFrom, '2026-10-13T12:00:00.000Z');
    state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-28T12:00:00.000Z');
    assert.equal((await s.f.pool.query("SELECT count(*)::int AS n FROM job_deliveries WHERE kind='card'")).rows[0].n, 2);
    assert.equal((await s.f.pool.query('SELECT status FROM job_deliveries WHERE id=$1', [first.id])).rows[0].status, 'sent');
  } finally { await s.f.close(); }
});

test('bounded reconciliation survives restart and temporary failures without becoming a daily reset', async () => {
  const s = await setup(); let failed = false;
  const hh = { async search({ page }) { if (failed) throw Object.assign(Error('fixture'), { code: 'JOB_HH_UNAVAILABLE' });
      return { found: 2, pages: 2, items: [{ id: String(page + 1) }] }; },
    async getVacancy({ externalId }) { return oldVacancy(externalId); } };
  try {
    assert.equal((await s.run(hh, { maxRequests: 2 })).outcome, 'JOB_COLLECTION_LIMIT');
    let state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_progress.windows[0].page, 1);
    assert.equal(state.reconciliation_checkpoint, null);
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-26T12:00:10.000Z');
    failed = true;
    assert.equal((await s.run(hh)).outcome, 'JOB_HH_UNAVAILABLE');
    state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_progress.windows[0].page, 1);
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-26T12:30:00.000Z');
    failed = false;
    assert.equal((await s.run(hh, { now: new Date('2026-10-27T13:00:00.000Z') })).outcome, 'complete');
    state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_checkpoint.toISOString(), NOW.toISOString(), 'checkpoint belongs to the resumed range');
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-28T13:00:00.000Z', 'daily interval starts after actual completion');
  } finally { await s.f.close(); }
});

test('inaccessible windows preserve gaps without success, allow other queries and start a new full cycle the next day', async () => {
  const s = await setup(['broad', 'narrow']); const requests = [];
  const oldCheckpoint = '2026-10-25T12:00:00.000Z';
  const progress = { until: NOW.toISOString(), lower: '2026-10-20T00:00:00.000Z', windowFormat: 'hh_calendar_v1',
    windows: [{ query: 'broad', from: '2026-10-25T21:00:00.000Z', to: NOW.toISOString(), page: 99, offset: 1 },
      { query: 'narrow', from: '2026-10-20T00:00:00.000Z', to: NOW.toISOString(), page: 0, offset: 0 }] };
  const hh = { capabilities: { dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 },
    async search(args) { requests.push(args); return args.query === 'broad'
      ? { found: 2001, pages: 101, items: [{ id: '99' }] } : { found: 1, pages: 1, items: [{ id: '1' }] }; },
    async getVacancy({ externalId }) { return oldVacancy(externalId); } };
  try {
    await s.f.pool.query('UPDATE job_searches SET reconciliation_progress=$1,reconciliation_checkpoint=$2 WHERE user_id=$3',
      [progress, oldCheckpoint, s.f.owner]);
    assert.equal((await s.run(hh)).outcome, 'JOB_COLLECTION_WINDOW_SATURATED');
    let state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_checkpoint.toISOString(), oldCheckpoint);
    assert.equal(state.reconciliation_progress.cycleFinished, true);
    assert.equal(state.reconciliation_progress.windows.length, 0);
    assert.equal(state.reconciliation_progress.gaps.length, 1);
    assert.deepEqual(state.reconciliation_progress.gaps[0].codes, ['JOB_COLLECTION_WINDOW_SATURATED']);
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-27T12:00:00.000Z');
    assert.equal((await s.f.pool.query("SELECT count(*)::int AS n FROM job_deliveries WHERE kind='card'")).rows[0].n, 1);
    assert.deepEqual(requests.map(args => args.query), ['broad', 'narrow']);
    const tomorrow = new Date(NOW.getTime() + DAY);
    const next = [];
    assert.equal((await s.run({ async search(args) { next.push(args); return { found: 0, pages: 0, items: [] }; } }, { now: tomorrow })).outcome, 'complete');
    assert.deepEqual(next.map(args => args.page), [0, 0]);
    assert.ok(next.every(args => args.publishedFrom === '2026-10-13T12:00:00.000Z'));
    state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_progress, null);
    assert.equal(state.reconciliation_checkpoint.toISOString(), tomorrow.toISOString());
  } finally { await s.f.close(); }
});

test('reconciliation notices use the existing view, their own cycle and current scope', async () => {
  const s = await setup(); let sends = 0;
  const worker = new JobDeliveryWorker({ pool: s.f.pool, searchRepository: s.history, deliveryRepository: s.delivery,
    accessService: s.accessService, send: async message => {
      sends++; assert.equal(message.buttons[0][0].data, 'job:menu'); return { message_id: sends };
    } });
  try {
    const raw = { until: NOW.toISOString(), cycleFinished: true, windows: [{ failureCode: 'JOB_HH_DOM_CHANGED' }] };
    await s.f.pool.query('UPDATE job_searches SET reconciliation_progress=$1 WHERE user_id=$2', [raw, s.f.owner]);
    const args = { userId: s.f.owner, runUntil: NOW.toISOString(), code: 'JOB_HH_DOM_CHANGED', lane: 'reconcile' };
    assert.ok(await s.delivery.enqueueCollectionAttention(args));
    assert.equal(await s.delivery.enqueueCollectionAttention(args), null);
    await worker.tick(); assert.equal(sends, 1);
    const later = '2026-10-27T12:00:00.000Z';
    await s.f.pool.query('UPDATE job_searches SET reconciliation_progress=$1 WHERE user_id=$2', [{ ...raw, until: later }, s.f.owner]);
    await s.delivery.enqueueCollectionAttention({ ...args, runUntil: later });
    await s.f.pool.query('UPDATE job_searches SET reconciliation_progress=NULL WHERE user_id=$1', [s.f.owner]);
    await worker.tick(); assert.equal(sends, 1, 'completed cycle retires its obsolete queued notice');
  } finally { await worker.close(); await s.f.close(); }
});

test('known inaccessible windows do not spend the next partial pass budget before other pages', async () => {
  const s = await setup(['broken', 'working']); let brokenRequests = 0;
  const hh = { async search({ query, page }) {
    if (query === 'broken') { brokenRequests++; throw Object.assign(Error('fixture'), { code: 'JOB_HH_DOM_CHANGED' }); }
    return { found: 2, pages: 2, items: [{ id: String(page + 1) }] };
  }, async getVacancy({ externalId }) { return oldVacancy(externalId); } };
  try {
    const run = () => s.run(hh, { maxRequests: 2 });
    assert.equal((await run()).outcome, 'JOB_COLLECTION_LIMIT');
    assert.equal((await run()).outcome, 'JOB_COLLECTION_LIMIT');
    assert.equal((await run()).outcome, 'JOB_HH_DOM_CHANGED');
    assert.equal(brokenRequests, 1);
    const state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_progress.cycleFinished, true);
    assert.equal(state.reconciliation_checkpoint, null);
    assert.equal((await s.f.pool.query("SELECT count(*)::int AS n FROM job_deliveries WHERE kind='card'")).rows[0].n, 2);
  } finally { await s.f.close(); }
});

test('default reconciliation pass is limited to eight HH requests', async () => {
  const s = await setup(); let details = 0;
  const hh = { async search() { return { found: 9, pages: 1, items: Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1) })) }; },
    async getVacancy({ externalId }) { details++; return oldVacancy(externalId); } };
  try {
    const result = await s.run(hh);
    assert.equal(result.outcome, 'JOB_COLLECTION_LIMIT'); assert.equal(result.requests, 8); assert.equal(details, 7);
    const state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_progress.windows[0].offset, 7);
    assert.equal(state.reconciliation_progress.cycleFinished, undefined);
  } finally { await s.f.close(); }
});

test('an oldest-day expiry at the 30-day midnight boundary is explicit and never marked complete', async () => {
  const s = await setup();
  const now = new Date('2026-10-26T20:59:59.900Z');
  try {
    const row = await s.history.getSettings({ userId: s.f.owner });
    await s.history.saveSettings({ scope: s.f.scope, expectedRevision: row.revision,
      settings: { ...row.settings, historyDays: 30 } });
    const result = await s.run({ capabilities: { dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 },
      async search({ publishedFrom }) {
        const browserTime = Date.parse('2026-10-26T21:00:00.200Z');
        assert.ok(browserTime - Date.parse(publishedFrom) > 30 * DAY);
        throw Object.assign(Error('fixture'), { code: 'JOB_COLLECTION_WINDOW_EXPIRED' });
      } }, { now });
    assert.equal(result.outcome, 'JOB_COLLECTION_WINDOW_EXPIRED');
    const state = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(state.reconciliation_checkpoint, null);
    assert.equal(state.reconciliation_progress.cycleFinished, true);
    assert.deepEqual(state.reconciliation_progress.gaps[0].codes, ['JOB_COLLECTION_WINDOW_EXPIRED']);
  } finally { await s.f.close(); }
});
