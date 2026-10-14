const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobUsageRepository, jobMonth } = require('../src/jobs/jobUsageRepository');

test('real PostgreSQL: isolation, concurrent dedup, restart, revisions and budget', async () => {
  const f = await createJobPostgresFixture();
  try {
    const search = new JobSearchRepository(f.pool), profiles = new JobProfileRepository(f.pool);
    const delivery = new JobDeliveryRepository(f.pool), drafts = new JobDraftRepository(f.pool);
    const usage = new JobUsageRepository(f.pool);
    const settings = await search.ensure({ scope: f.scope });
    await assert.rejects(search.ensure({ scope: { ...f.scope, userId: f.stranger } }));
    const saved = await search.saveSettings({ scope: f.scope, expectedRevision: settings.revision,
      settings: { ...settings.settings, activated: true } });
    await assert.rejects(search.saveSettings({ scope: f.scope, expectedRevision: 1, settings: settings.settings }), { code: 'JOB_REVISION_CONFLICT' });
    const snapshot = { title: 'AI Engineer', publishedAt: '2026-10-15T00:00:00Z' };
    const vacancy = await search.upsertVacancy({ externalId: '123', snapshot });
    const same = await search.upsertVacancy({ externalId: '123', snapshot });
    assert.equal(same.revision, 1);
    await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: saved.revision });
    await Promise.all(Array.from({ length: 8 }, () => delivery.enqueue({ userId: f.owner, vacancyId: vacancy.id })));
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 1);
    const claims = await Promise.all([delivery.claim(), new JobDeliveryRepository(f.pool).claim()]);
    assert.equal(claims.filter(Boolean).length, 1);
    await delivery.finish({ deliveryId: claims.find(Boolean).id, outcome: 'sent', telegramMessageId: '1' });
    assert.equal(await new JobDeliveryRepository(f.pool).claim(), null);
    assert.equal(await search.getVacancy({ userId: f.stranger, vacancyId: vacancy.id }), null);
    const profile = await profiles.replace({ scope: f.scope, expectedRevision: 0,
      profile: { confirmed: true, facts: [{ id: 'example', text: 'Confirmed fixture project', confirmed: true }], examples: [] } });
    const draft = await drafts.append({ scope: f.scope, vacancyId: vacancy.id, profileRevision: profile.revision,
      vacancyRevision: vacancy.revision, text: 'Fixture letter', facts: ['example'] });
    assert.equal(await drafts.get({ userId: f.stranger, draftId: draft.id }), null);
    await drafts.append({ scope: f.scope, vacancyId: vacancy.id, parentDraftId: draft.id,
      profileRevision: 1, vacancyRevision: 1, text: 'Revised fixture letter', facts: ['example'] });
    await assert.rejects(drafts.append({ scope: f.scope, vacancyId: vacancy.id, parentDraftId: draft.id,
      profileRevision: 1, vacancyRevision: 1, text: 'Stale fixture letter', facts: [] }), { code: 'JOB_REVISION_CONFLICT' });
    const requestId = crypto.randomUUID();
    const now = new Date('2026-10-31T21:01:00Z');
    assert.equal(jobMonth(now), '2026-11');
    await usage.record({ userId: f.owner, requestId, costUsd: 3.01, outcome: 'success', occurredAt: now });
    await usage.record({ userId: f.owner, requestId, costUsd: 3.01, outcome: 'success', occurredAt: now });
    assert.equal((await usage.getMonth({ userId: f.owner, now })).total, 3.01);
    const notices = await Promise.all([usage.claimBudgetNotice({ userId: f.owner, now, thresholdUsd: 3 }),
      usage.claimBudgetNotice({ userId: f.owner, now, thresholdUsd: 3 })]);
    assert.equal(notices.filter(Boolean).length, 1);
    await usage.record({ userId: f.owner, requestId: crypto.randomUUID(), costUsd: null, outcome: 'failed', occurredAt: now });
    assert.equal((await usage.getMonth({ userId: f.owner, now })).pending, 1);
    console.log('PASS real PostgreSQL: owner isolation, leases, dedup, draft revisions, usage and budget notice');
  } finally { await f.close(); }
});
