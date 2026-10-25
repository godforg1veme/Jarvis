const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const { JobCollector } = require('../src/jobs/jobCollector');

const NOW = new Date('2026-10-25T12:00:00.000Z');
const vacancy = (externalId, publishedAt = '2026-10-25T11:58:00.000Z') => ({ externalId,
  title: 'Fixture engineer', description: 'Engineering', publishedAt, city: 'Москва', workFormat: 'office' });

async function setup() {
  const f = await createJobPostgresFixture();
  const accessService = configuredOwnerJobAccess(f.pool, '101');
  const history = new JobSearchRepository(f.pool, { accessService });
  const fresh = new JobSearchRepository(f.pool, { accessService, lane: 'fresh' });
  const delivery = new JobDeliveryRepository(f.pool, { accessService });
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
  const initial = await history.ensure({ scope: f.scope });
  await history.saveSettings({ scope: f.scope, expectedRevision: initial.revision,
    settings: { ...initial.settings, queries: ['Fixture'], activated: true, paused: false } });
  return { f, history, fresh, delivery, accessService,
    run(hhClient, options = {}, now = NOW) {
      return new JobCollector({ searchRepository: fresh, deliveryRepository: delivery, hhClient,
        now: () => now, wait: async () => {}, lane: 'fresh', ...options })
        .runOnce({ userId: f.owner, now, force: true });
    } };
}

test('fresh arrivals are collected while historical progress remains unfinished, using the same filters', async () => {
  const s = await setup();
  const oldProgress = { lower: '2026-10-11T12:00:00.000Z', until: '2026-10-25T11:00:00.000Z',
    windows: [{ query: 'Fixture', from: '2026-10-11T12:00:00.000Z', to: '2026-10-25T11:00:00.000Z', page: 4, offset: 7 }] };
  try {
    await s.f.pool.query('UPDATE job_searches SET progress=$1 WHERE user_id=$2', [oldProgress, s.f.owner]);
    const ranges = [];
    const result = await s.run({
      async search(args) { ranges.push(args); return { found: 2, pages: 1, items: [{ id: '1' }, { id: '2' }] }; },
      async getVacancy({ externalId }) { return externalId === '2'
        ? vacancy('2', '2026-10-25T10:59:59.999Z') : vacancy('1'); },
    });
    assert.equal(result.outcome, 'complete'); assert.equal(result.matched, 1);
    assert.equal(ranges[0].query, 'Fixture');
    assert.equal(ranges[0].publishedFrom, '2026-10-25T11:00:00.000Z');
    const row = await s.history.getSettings({ userId: s.f.owner });
    assert.deepEqual(row.progress, oldProgress); assert.equal(row.checkpoint, null);
    assert.equal(row.fresh_checkpoint.toISOString(), NOW.toISOString()); assert.equal(row.fresh_progress, null);
    assert.equal(row.fresh_next_check_at.toISOString(), '2026-10-25T12:05:00.000Z');
    assert.deepEqual((await s.f.pool.query('SELECT priority FROM job_deliveries')).rows, [{ priority: 1 }]);
  } finally { await s.f.close(); }
});

test('fresh pagination resumes after request budget and failure without moving its checkpoint', async () => {
  const s = await setup(); let fail = false;
  const hh = {
    async search({ page }) { if (fail) throw Object.assign(Error('fixture'), { code: 'JOB_HH_UNAVAILABLE' });
      return { found: 2, pages: 2, items: [{ id: String(page + 1) }] }; },
    async getVacancy({ externalId }) { return vacancy(externalId); },
  };
  try {
    assert.equal((await s.run(hh, { maxRequests: 2 })).outcome, 'JOB_COLLECTION_LIMIT');
    let row = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(row.fresh_progress.windows[0].page, 1); assert.equal(row.fresh_checkpoint, null);
    assert.equal(row.fresh_next_check_at.toISOString(), '2026-10-25T12:00:10.000Z');
    fail = true; assert.equal((await s.run(hh)).outcome, 'JOB_HH_UNAVAILABLE');
    row = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(row.fresh_progress.windows[0].page, 1); assert.equal(row.fresh_checkpoint, null);
    fail = false; assert.equal((await s.run(hh)).outcome, 'complete');
    row = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(row.fresh_checkpoint.toISOString(), NOW.toISOString()); assert.equal(row.fresh_progress, null);
    assert.equal((await s.f.pool.query("SELECT count(*)::int AS n FROM job_deliveries WHERE kind='card'")).rows[0].n, 2);
  } finally { await s.f.close(); }
});

test('overlap rechecks queued cards, skips sent matches and retains missing time after downtime', async () => {
  const s = await setup(); const reads = [], ranges = [];
  try {
    const row = await s.history.getSettings({ userId: s.f.owner });
    const known = await s.history.upsertVacancy({ externalId: '1', snapshot: vacancy('1') });
    await s.history.recordMatch({ userId: s.f.owner, vacancyId: known.id, filterRevision: row.revision });
    await s.delivery.enqueue({ userId: s.f.owner, vacancyId: known.id });
    const hh = { async search(args) { ranges.push(args); return { found: 1, pages: 1, items: [{ id: '1' }] }; },
      async getVacancy({ externalId }) { reads.push(externalId); return vacancy(externalId); } };
    assert.equal((await s.run(hh)).outcome, 'complete'); assert.deepEqual(reads, ['1']);
    assert.equal((await s.f.pool.query('SELECT priority FROM job_deliveries')).rows[0].priority, 1);
    await s.f.pool.query("UPDATE job_deliveries SET status='sent'");
    const later = new Date('2026-10-26T12:00:00.000Z');
    assert.equal((await s.run(hh, {}, later)).outcome, 'complete');
    assert.equal(ranges[1].publishedFrom, '2026-10-25T11:00:00.000Z', 'checkpoint overlap covers the full missed day');
    assert.equal(ranges[1].publishedTo, later.toISOString());
    assert.deepEqual(reads, ['1'], 'confirmed delivery needs no repeat detail read or card');
    assert.equal((await s.f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 1);
  } finally { await s.f.close(); }
});

test('an archived queued match is rechecked and never promoted from a stale snapshot', async () => {
  const s = await setup(); let reads = 0;
  try {
    const row = await s.history.getSettings({ userId: s.f.owner });
    const stored = await s.history.upsertVacancy({ externalId: '1', snapshot: vacancy('1') });
    await s.history.recordMatch({ userId: s.f.owner, vacancyId: stored.id, filterRevision: row.revision });
    await s.delivery.enqueue({ userId: s.f.owner, vacancyId: stored.id });
    await s.run({ async search() { return { found: 1, pages: 1, items: [{ id: '1' }] }; },
      async getVacancy() { reads++; return { ...vacancy('1'), archived: true }; } });
    assert.equal(reads, 1);
    assert.equal((await s.f.pool.query('SELECT priority FROM job_deliveries')).rows[0].priority, 0);
  } finally { await s.f.close(); }
});

test('new head is checked after five minutes while a partial fresh cursor and notice identity survive', async () => {
  const s = await setup(); const requests = [];
  const partial = { until: NOW.toISOString(), lower: '2026-10-25T11:00:00.000Z', windowFormat: 'hh_calendar_v1',
    windows: [{ query: 'Fixture', from: '2026-10-25T11:00:00.000Z', to: NOW.toISOString(), page: 3, offset: 7 }] };
  try {
    await s.f.pool.query('UPDATE job_searches SET fresh_progress=$1 WHERE user_id=$2', [partial, s.f.owner]);
    const later = new Date('2026-10-25T12:05:00.000Z');
    const result = await s.run({
      async search(args) { requests.push(args); return { found: 1, pages: 1, items: [{ id: '9' }] }; },
      async getVacancy() { return vacancy('9', '2026-10-25T12:04:00.000Z'); },
    }, { maxRequests: 2 }, later);
    assert.equal(result.outcome, 'JOB_COLLECTION_LIMIT');
    assert.equal(requests[0].page, 0); assert.equal(requests[0].publishedTo, later.toISOString());
    const row = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(row.fresh_checkpoint, null);
    assert.equal(row.fresh_progress.until, NOW.toISOString(), 'notice run identity remains stable');
    assert.equal(row.fresh_progress.headUntil, later.toISOString());
    assert.deepEqual(row.fresh_progress.windows[0], partial.windows[0]);
    assert.equal((await s.f.pool.query("SELECT count(*)::int AS n FROM job_deliveries WHERE priority=1")).rows[0].n, 1);
  } finally { await s.f.close(); }
});

test('saturated fresh day still reads newest cards, retains incomplete state and refreshes without notice spam', async () => {
  const s = await setup(); let id = '1';
  const requests = [], reads = [];
  const hh = { capabilities: { dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 },
    async search(args) { requests.push(args); return { found: 2001, pages: 101, items: [{ id }] }; },
    async getVacancy({ externalId }) { reads.push(externalId); return vacancy(externalId,
      externalId === '2' ? '2026-10-25T12:04:00.000Z' : '2026-10-25T11:58:00.000Z'); } };
  try {
    assert.equal((await s.run(hh, { maxRequests: 2 })).outcome, 'JOB_COLLECTION_LIMIT');
    let row = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(row.fresh_progress.windows[0].page, 1); assert.deepEqual(reads, ['1']);
    assert.equal(row.fresh_checkpoint, null);
    // Exhausting the accessible cap must leave a durable gap, never a complete checkpoint.
    const progress = row.fresh_progress;
    progress.windows[0].page = 99; progress.windows[0].offset = 1;
    await s.f.pool.query('UPDATE job_searches SET fresh_progress=$1 WHERE user_id=$2', [progress, s.f.owner]);
    assert.equal((await s.run(hh)).outcome, 'JOB_COLLECTION_WINDOW_SATURATED');
    row = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(row.fresh_progress.windows[0].exhausted, true); assert.equal(row.fresh_checkpoint, null);
    id = '2';
    assert.equal((await s.run(hh, { maxRequests: 2 }, new Date('2026-10-25T12:05:00.000Z'))).outcome, 'JOB_COLLECTION_LIMIT');
    assert.equal(requests.at(-1).page, 0); assert.deepEqual(reads, ['1', '2']);
    row = await s.history.getSettings({ userId: s.f.owner });
    assert.equal(row.fresh_checkpoint, null);
    assert.equal(row.fresh_progress.until, NOW.toISOString());
    assert.equal((await s.f.pool.query("SELECT count(*)::int AS n FROM job_deliveries WHERE kind='attention'")).rows[0].n, 1);
  } finally { await s.f.close(); }
});

test('fresh discovery does not promote an old known match outside the exact publication range', async () => {
  const s = await setup(); let reads = 0;
  try {
    const row = await s.history.getSettings({ userId: s.f.owner });
    const old = vacancy('1', '2026-10-25T09:00:00.000Z');
    const stored = await s.history.upsertVacancy({ externalId: '1', snapshot: old });
    await s.history.recordMatch({ userId: s.f.owner, vacancyId: stored.id, filterRevision: row.revision });
    await s.delivery.enqueue({ userId: s.f.owner, vacancyId: stored.id });
    await s.run({ async search() { return { found: 1, pages: 1, items: [{ id: '1' }] }; },
      async getVacancy() { reads++; return old; } });
    assert.equal(reads, 1);
    assert.equal((await s.f.pool.query('SELECT priority FROM job_deliveries')).rows[0].priority, 0);
  } finally { await s.f.close(); }
});

test('delivery prioritizes attention and fresh cards, and promotion never replays sent, sending or unknown', async () => {
  const s = await setup();
  try {
    const enqueue = async id => {
      const stored = await s.history.upsertVacancy({ externalId: id, snapshot: vacancy(id) });
      await s.history.recordMatch({ userId: s.f.owner, vacancyId: stored.id, filterRevision: 2 });
      const queued = await s.delivery.enqueue({ userId: s.f.owner, vacancyId: stored.id });
      return { stored, queued };
    };
    const old = await enqueue('1'), fresh = await enqueue('2');
    await s.delivery.enqueue({ userId: s.f.owner, vacancyId: fresh.stored.id, priority: 1 });
    await s.f.pool.query("INSERT INTO job_deliveries(user_id,kind,dedup_key,payload) VALUES($1,'attention','fixture-attention','{}')", [s.f.owner]);
    let claim = await s.delivery.claim(); assert.equal(claim.kind, 'attention');
    await s.delivery.finish({ deliveryId: claim.id, outcome: 'sent' });
    claim = await s.delivery.claim(); assert.equal(claim.id, fresh.queued.id);
    await s.delivery.finish({ deliveryId: claim.id, outcome: 'sent' });
    claim = await s.delivery.claim(); assert.equal(claim.id, old.queued.id);
    await s.delivery.finish({ deliveryId: claim.id, outcome: 'unknown' });
    const sending = await enqueue('3'); await s.delivery.claim();
    for (const stored of [old.stored, fresh.stored, sending.stored]) {
      assert.equal(await s.delivery.enqueue({ userId: s.f.owner, vacancyId: stored.id, priority: 1 }), null);
    }
    assert.equal(await s.delivery.claim(), null);
    assert.deepEqual((await s.f.pool.query('SELECT status FROM job_deliveries WHERE kind=\'card\' ORDER BY dedup_key')).rows.map(r => r.status).sort(),
      ['sending', 'sent', 'unknown'].sort());
  } finally { await s.f.close(); }
});

test('fresh incomplete notices bind to fresh progress and reject completed or malformed lane state', async () => {
  const s = await setup(); let sends = 0;
  const worker = new JobDeliveryWorker({ pool: s.f.pool, searchRepository: s.history,
    deliveryRepository: s.delivery, accessService: s.accessService,
    send: async () => { sends++; return { message_id: sends }; } });
  try {
    await s.f.pool.query('UPDATE job_searches SET fresh_progress=$1 WHERE user_id=$2', [{ until: NOW.toISOString() }, s.f.owner]);
    assert.equal(await s.delivery.enqueueCollectionAttention({ userId: s.f.owner, runUntil: NOW.toISOString(), code: 'JOB_HH_DOM_CHANGED' }), null);
    await s.delivery.enqueueCollectionAttention({ userId: s.f.owner, runUntil: NOW.toISOString(), code: 'JOB_HH_DOM_CHANGED', lane: 'fresh' });
    await worker.tick(); assert.equal(sends, 1);
    const later = '2026-10-25T12:05:00.000Z';
    await s.f.pool.query('UPDATE job_searches SET fresh_progress=$1 WHERE user_id=$2', [{ until: later }, s.f.owner]);
    await s.delivery.enqueueCollectionAttention({ userId: s.f.owner, runUntil: later, code: 'JOB_HH_DOM_CHANGED', lane: 'fresh' });
    await s.f.pool.query('UPDATE job_searches SET fresh_progress=NULL WHERE user_id=$1', [s.f.owner]);
    await worker.tick(); assert.equal(sends, 1);
  } finally { await worker.close(); await s.f.close(); }
});
