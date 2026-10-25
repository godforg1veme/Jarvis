const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');

test('fresh and historical searches keep separate cursors behind one per-user lease', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const history = new JobSearchRepository(f.pool, { accessService });
    const fresh = new JobSearchRepository(f.pool, { accessService, lane: 'fresh' });
    assert.throws(() => new JobSearchRepository(f.pool, { lane: 'untrusted' }), { code: 'JOB_INVALID_SEARCH' });
    let state = await history.ensure({ scope: f.scope });
    state = await history.saveSettings({ scope: f.scope, expectedRevision: state.revision,
      settings: { ...state.settings, queries: ['AI Engineer'], activated: true, paused: false } });
    const now = new Date();
    const historyLease = await history.claimSearch({ userId: f.owner, now, force: true });
    assert.ok(historyLease);
    assert.equal(await fresh.claimSearch({ userId: f.owner, now, force: true }), null);
    const oldProgress = { until: now.toISOString(), lower: now.toISOString(), windows: [] };
    await history.saveProgress({ userId: f.owner, leaseId: historyLease.lease_id, progress: oldProgress });
    await history.finishSearch({ userId: f.owner, leaseId: historyLease.lease_id, checkpoint: null,
      nextCheckAt: new Date(now.getTime() + 1800000) });

    const freshLease = await fresh.claimSearch({ userId: f.owner, now, force: true });
    assert.ok(freshLease);
    assert.equal(freshLease.progress, null);
    assert.equal(freshLease.checkpoint, null);
    assert.equal(await history.claimSearch({ userId: f.owner, now, force: true }), null);
    const freshProgress = { until: now.toISOString(), lower: now.toISOString(), windows: [{ query: 'AI Engineer', page: 0, offset: 2 }] };
    await fresh.saveProgress({ userId: f.owner, leaseId: freshLease.lease_id, progress: freshProgress });
    state = await fresh.getSettings({ userId: f.owner });
    assert.deepEqual(state.progress, oldProgress);
    assert.deepEqual(state.fresh_progress, freshProgress);
    await fresh.finishSearch({ userId: f.owner, leaseId: freshLease.lease_id, checkpoint: now.toISOString(),
      nextCheckAt: new Date(now.getTime() + 300000) });
    state = await history.getSettings({ userId: f.owner });
    assert.deepEqual(state.progress, oldProgress);
    assert.equal(state.checkpoint, null);
    assert.equal(state.fresh_checkpoint.toISOString(), now.toISOString());
    assert.equal(state.fresh_progress, null);

    const nextFresh = await fresh.claimSearch({ userId: f.owner, now, force: true });
    assert.equal(nextFresh.checkpoint.toISOString(), now.toISOString());
    await fresh.saveProgress({ userId: f.owner, leaseId: nextFresh.lease_id, progress: freshProgress });
    state = await history.setEnabled({ scope: f.scope, expectedRevision: state.revision, enabled: false });
    assert.deepEqual(state.fresh_progress, freshProgress);
    assert.equal(await fresh.claimSearch({ userId: f.owner, now, force: true }), null);
    state = await history.setEnabled({ scope: f.scope, expectedRevision: state.revision, enabled: true });
    assert.ok(state.fresh_next_check_at <= new Date());
    const resumed = await fresh.claimSearch({ userId: f.owner, now: new Date(), force: true });
    assert.deepEqual(resumed.progress, freshProgress);
    await fresh.finishSearch({ userId: f.owner, leaseId: resumed.lease_id, checkpoint: null,
      nextCheckAt: new Date(now.getTime() + 300000) });

    state = await history.getSettings({ userId: f.owner });
    state = await history.saveSettings({ scope: f.scope, expectedRevision: state.revision,
      settings: { ...state.settings, exclusions: ['Sales'] } });
    assert.equal(state.fresh_checkpoint, null);
    assert.equal(state.fresh_progress, null);
    assert.deepEqual(state.progress, null);
  } finally { await f.close(); }
});

test('fresh due ordering, bounded result, current access and user-scoped match cache', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const fresh = new JobSearchRepository(f.pool, { accessService, lane: 'fresh' });
    const history = new JobSearchRepository(f.pool, { accessService });
    let owner = await history.ensure({ scope: f.scope });
    owner = await history.saveSettings({ scope: f.scope, expectedRevision: owner.revision,
      settings: { ...owner.settings, queries: ['AI Engineer'], activated: true, paused: false } });
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','202')", [f.stranger]);
    const conversation = (await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','202') RETURNING id", [f.stranger])).rows[0].id;
    await f.pool.query(`INSERT INTO job_searches(user_id,conversation_id,chat_id,settings,fresh_next_check_at)
      VALUES($1,$2,'202',$3,now()-interval '1 hour')`, [f.stranger, conversation, owner.settings]);
    await f.pool.query("UPDATE job_searches SET fresh_next_check_at=now()-interval '1 minute' WHERE user_id=$1", [f.owner]);
    assert.deepEqual(await fresh.dueUsers({ limit: 1 }), [{ user_id: f.owner }], 'revoked earlier row does not block owner');
    await assert.rejects(fresh.claimSearch({ userId: f.stranger, now: new Date(), force: true }), { code: 'JOB_SCOPE_DENIED' });
    const publishedFrom = new Date(Date.now() - 3600000).toISOString();
    const publishedTo = new Date(Date.now() + 3600000).toISOString();
    await assert.rejects(fresh.matchedVacancies({ userId: f.stranger, externalIds: ['123'],
      filterRevision: owner.revision, publishedFrom, publishedTo }), { code: 'JOB_SCOPE_DENIED' });

    const allAccess = { repository: { async get(_db, field, userId) {
      assert.equal(field, 'user');
      return { userId, blocked: false, permissions: ['jobs'] };
    } } };
    const ordered = new JobSearchRepository(f.pool, { accessService: allAccess, lane: 'fresh' });
    assert.deepEqual((await ordered.dueUsers({ limit: 1 })).map(row => row.user_id), [f.stranger]);
    assert.deepEqual((await ordered.dueUsers({ limit: 2 })).map(row => row.user_id), [f.stranger, f.owner]);
    await assert.rejects(ordered.dueUsers({ limit: 101 }), { code: 'JOB_INVALID_SEARCH' });

    const vacancy = await history.upsertVacancy({ externalId: '123', snapshot: { title: 'AI Engineer',
      url: 'https://hh.ru/vacancy/123', publishedAt: new Date().toISOString() } });
    await history.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: owner.revision });
    assert.deepEqual(await fresh.matchedVacancies({ userId: f.owner, externalIds: ['123'],
      filterRevision: owner.revision, publishedFrom, publishedTo }), new Map(), 'unsent cards must be read before promotion');
    await f.pool.query("INSERT INTO job_deliveries(user_id,vacancy_id,dedup_key,status) VALUES($1,$2,$3,'sent')",
      [f.owner, vacancy.id, `card:${vacancy.id}`]);
    assert.deepEqual(await fresh.matchedVacancies({ userId: f.owner, externalIds: ['123', '456'],
      filterRevision: owner.revision, publishedFrom, publishedTo }), new Map([['123', vacancy.id]]));
    assert.deepEqual(await fresh.matchedVacancies({ userId: f.owner, externalIds: ['123'],
      filterRevision: owner.revision + 1, publishedFrom, publishedTo }), new Map());
    assert.deepEqual(await fresh.matchedVacancies({ userId: f.owner, externalIds: ['123'],
      filterRevision: owner.revision, publishedFrom: new Date(Date.now() + 3600000).toISOString(),
      publishedTo: new Date(Date.now() + 7200000).toISOString() }), new Map());
    assert.deepEqual(await ordered.matchedVacancies({ userId: f.stranger, externalIds: ['123'],
      filterRevision: owner.revision, publishedFrom, publishedTo }), new Map(), 'another permitted user cannot see owner matches');
    await assert.rejects(fresh.matchedVacancies({ userId: f.owner, externalIds: ['not-an-id'],
      filterRevision: owner.revision, publishedFrom, publishedTo }),
      { code: 'JOB_INVALID_VACANCY' });
    await f.pool.query("DELETE FROM user_identities WHERE user_id=$1 AND provider='telegram'", [f.owner]);
    await assert.rejects(fresh.matchedVacancies({ userId: f.owner, externalIds: ['123'],
      filterRevision: owner.revision, publishedFrom, publishedTo }), { code: 'JOB_SCOPE_DENIED' });
  } finally { await f.close(); }
});
