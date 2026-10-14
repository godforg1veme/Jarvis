const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobUsageRepository } = require('../src/jobs/jobUsageRepository');
const { JobModelAdapter } = require('../src/jobs/jobModelAdapter');
const { JobDraftService } = require('../src/jobs/jobDraftService');

test('real PostgreSQL: model only on request, duplicate request, revisions, failure retention and budget continues', async () => {
  const f = await createJobPostgresFixture(); let calls = 0, fail = false;
  try {
    const search = new JobSearchRepository(f.pool), profile = new JobProfileRepository(f.pool), drafts = new JobDraftRepository(f.pool);
    const usage = new JobUsageRepository(f.pool);
    const s = await search.ensure({ scope: f.scope });
    await search.saveSettings({ scope: f.scope, expectedRevision: 1, settings: { ...s.settings, model: 'fixture-model' } });
    const vacancy = await search.upsertVacancy({ externalId: '777', snapshot: {
      title: 'Junior AI Engineer', company: 'Fixture', publishedAt: '2026-10-15T10:00:00Z', description: 'AI automation' } });
    await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
    await profile.replace({ scope: f.scope, expectedRevision: 0, profile: { confirmed: true,
      facts: [{ id: 'automation', text: 'Confirmed automation fixture', confirmed: true }], examples: [] } });
    const adapter = new JobModelAdapter({ config: { openrouterApiKey: crypto.randomUUID() }, fetchImpl: async (_url, init) => {
      calls++; const body = JSON.parse(init.body);
      assert.equal(body.usage.include, true); assert.equal(body.max_tokens, 3000);
      if (fail) throw new Error('Fixture disconnected');
      return Response.json({ id: `fixture-${calls}`, usage: { cost: 1.6 }, choices: [{ message: {
        content: JSON.stringify({ text: `Letter version ${calls}`, factIds: ['automation'] }) } }] });
    } });
    const service = new JobDraftService({ pool: f.pool, searchRepository: search, profileRepository: profile,
      draftRepository: drafts, usageRepository: usage, modelAdapter: adapter });
    assert.equal(calls, 0);
    const requestId = crypto.randomUUID();
    const first = await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId });
    assert.equal(calls, 1);
    assert.equal((await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId })).id, first.id);
    assert.equal(calls, 1);
    const second = await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId: crypto.randomUUID(),
      parentDraftId: first.id, instruction: 'Shorter', language: 'ru' });
    assert.notEqual(first.id, second.id);
    assert.equal((await usage.getMonth({ userId: f.owner })).total, 3.2);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_budget_notices')).rows[0].n, 1);
    fail = true;
    await assert.rejects(service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId: crypto.randomUUID(),
      parentDraftId: second.id, language: 'en' }), { code: 'JOB_MODEL_UNAVAILABLE' });
    assert.equal((await drafts.current({ userId: f.owner, vacancyId: vacancy.id })).id, second.id);
    fail = false;
    await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId: crypto.randomUUID(), parentDraftId: second.id });
    assert.equal(calls, 4, 'generation continues after the soft budget threshold');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_budget_notices')).rows[0].n, 1);
    await assert.rejects(service.generate({ scope: { ...f.scope, userId: f.stranger }, vacancyId: vacancy.id,
      requestId: crypto.randomUUID() }));
    assert.equal(calls, 4);
    console.log('PASS generation acceptance: scoped facts, model calls, dedup, versions, failures and soft budget');
  } finally { await f.close(); }
});
