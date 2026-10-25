const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');

test('daily reconciliation keeps its own cursor and progress behind the shared lease', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const history = new JobSearchRepository(f.pool, { accessService });
    const fresh = new JobSearchRepository(f.pool, { accessService, lane: 'fresh' });
    const reconcile = new JobSearchRepository(f.pool, { accessService, lane: 'reconcile' });
    let row = await history.ensure({ scope: f.scope });
    row = await history.saveSettings({ scope: f.scope, expectedRevision: row.revision,
      settings: { ...row.settings, queries: ['AI Engineer'], activated: true, paused: false } });
    const now = new Date();
    assert.ok(row.reconciliation_next_check_at.getTime() > now.getTime() + 23 * 60 * 60 * 1000);
    assert.deepEqual(await reconcile.dueUsers({ now }), []);

    const historyLease = await history.claimSearch({ userId: f.owner, now, force: true });
    assert.equal(await reconcile.claimSearch({ userId: f.owner, now, force: true }), null);
    await history.finishSearch({ userId: f.owner, leaseId: historyLease.lease_id, checkpoint: now.toISOString(),
      nextCheckAt: new Date(now.getTime() + 60 * 60 * 1000) });
    const freshLease = await fresh.claimSearch({ userId: f.owner, now, force: true });
    assert.equal(await reconcile.claimSearch({ userId: f.owner, now, force: true }), null);
    await fresh.finishSearch({ userId: f.owner, leaseId: freshLease.lease_id, checkpoint: now.toISOString(),
      nextCheckAt: new Date(now.getTime() + 5 * 60 * 1000) });

    await f.pool.query("UPDATE job_searches SET reconciliation_next_check_at=now()-interval '1 minute' WHERE user_id=$1", [f.owner]);
    assert.deepEqual(await reconcile.dueUsers({ now: new Date() }), [{ user_id: f.owner }]);
    const lease = await reconcile.claimSearch({ userId: f.owner, now: new Date() });
    assert.ok(lease);
    assert.equal(lease.checkpoint, null);
    assert.equal(lease.progress, null);
    assert.equal(await history.claimSearch({ userId: f.owner, now, force: true }), null);
    assert.equal(await fresh.claimSearch({ userId: f.owner, now, force: true }), null);
    const progress = { until: now.toISOString(), lower: now.toISOString(), windows: [{ query: 'AI Engineer', page: 2 }] };
    await reconcile.saveProgress({ userId: f.owner, leaseId: lease.lease_id, progress });
    row = await reconcile.getSettings({ userId: f.owner });
    assert.deepEqual(row.reconciliation_progress, progress);
    assert.equal(row.checkpoint.toISOString(), now.toISOString());
    assert.equal(row.fresh_checkpoint.toISOString(), now.toISOString());
    assert.equal(row.progress, null);
    assert.equal(row.fresh_progress, null);
    assert.equal(await reconcile.finishSearch({ userId: f.owner, leaseId: lease.lease_id,
      checkpoint: now.toISOString(), nextCheckAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) }), true);
    row = await reconcile.getSettings({ userId: f.owner });
    assert.equal(row.reconciliation_checkpoint.toISOString(), now.toISOString());
    assert.equal(row.reconciliation_progress, null);
    assert.deepEqual(await reconcile.dueUsers({ now: new Date() }), []);

    const overdue = new Date(now.getTime() - 60 * 1000);
    await f.pool.query('UPDATE job_searches SET reconciliation_next_check_at=$1 WHERE user_id=$2', [overdue, f.owner]);
    row = await history.setEnabled({ scope: f.scope, expectedRevision: row.revision, enabled: false });
    assert.deepEqual(await reconcile.dueUsers({ now: new Date() }), []);
    row = await history.setEnabled({ scope: f.scope, expectedRevision: row.revision, enabled: true });
    assert.equal(row.reconciliation_next_check_at.toISOString(), overdue.toISOString(), 'resume keeps an overdue reconciliation due');
    const retry = await reconcile.claimSearch({ userId: f.owner, now: new Date() });
    assert.ok(retry);
    const gap = { ...progress, cycleFinished: true, gaps: [{ query: 'AI Engineer', from: now.toISOString() }] };
    await reconcile.saveProgress({ userId: f.owner, leaseId: retry.lease_id, progress: gap });
    await reconcile.finishSearch({ userId: f.owner, leaseId: retry.lease_id, checkpoint: null,
      nextCheckAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), failureCode: 'JOB_COLLECTION_WINDOW_SATURATED' });
    row = await reconcile.getSettings({ userId: f.owner });
    assert.equal(row.reconciliation_checkpoint.toISOString(), now.toISOString(), 'incomplete cycle cannot advance last good checkpoint');
    assert.deepEqual(row.reconciliation_progress, gap);
    const nextCycle = await reconcile.claimSearch({ userId: f.owner, now: new Date(), force: true });
    assert.equal(nextCycle.progress, null, 'next daily cycle starts from full history range');
    assert.deepEqual(nextCycle.reconciliation_progress, gap, 'raw gaps remain available for diagnostics');
    assert.equal(nextCycle.checkpoint.toISOString(), now.toISOString());
    await reconcile.saveProgress({ userId: f.owner, leaseId: nextCycle.lease_id, progress });
    row = await reconcile.setEnabled({ scope: f.scope, expectedRevision: row.revision, enabled: false });
    assert.deepEqual(row.reconciliation_progress, progress, 'pause preserves resumable progress');
    row = await history.setEnabled({ scope: f.scope, expectedRevision: row.revision, enabled: true });
    assert.deepEqual((await reconcile.claimSearch({ userId: f.owner, now: new Date(), force: true })).progress, progress);
    row = await history.saveSettings({ scope: f.scope, expectedRevision: row.revision,
      settings: { ...row.settings, exclusions: ['Sales'] } });
    assert.equal(row.reconciliation_checkpoint, null);
    assert.equal(row.reconciliation_progress, null);
    assert.ok(row.reconciliation_next_check_at.getTime() > Date.now() + 23 * 60 * 60 * 1000);
  } finally { await f.close(); }
});

test('reconciliation excludes revoked access and rejects another user scope', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const reconcile = new JobSearchRepository(f.pool, { accessService: configuredOwnerJobAccess(f.pool, '101'), lane: 'reconcile' });
    let row = await reconcile.ensure({ scope: f.scope });
    row = await reconcile.saveSettings({ scope: f.scope, expectedRevision: row.revision,
      settings: { ...row.settings, queries: ['AI Engineer'], activated: true, paused: false } });
    await f.pool.query("UPDATE job_searches SET reconciliation_next_check_at=now()-interval '1 minute' WHERE user_id=$1", [f.owner]);
    await assert.rejects(reconcile.ensure({ scope: { ...f.scope, userId: f.stranger } }), { code: 'JOB_SCOPE_DENIED' });
    const lease = await reconcile.claimSearch({ userId: f.owner, now: new Date() });
    assert.ok(lease);
    await f.pool.query("DELETE FROM user_identities WHERE user_id=$1 AND provider='telegram'", [f.owner]);
    assert.equal(await reconcile.renewSearch({ userId: f.owner, leaseId: lease.lease_id, revision: row.revision, now: new Date() }), false);
    assert.equal(await reconcile.finishSearch({ userId: f.owner, leaseId: lease.lease_id, checkpoint: null,
      nextCheckAt: new Date() }), false);
    await assert.rejects(reconcile.claimSearch({ userId: f.owner, now: new Date(), force: true }), { code: 'JOB_SCOPE_DENIED' });
    await f.pool.query('UPDATE job_searches SET lease_id=NULL,lease_until=NULL WHERE user_id=$1', [f.owner]);
    assert.deepEqual(await reconcile.dueUsers({ now: new Date() }), []);
  } finally { await f.close(); }
});
