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
const { recoverJobGenerations } = require('../src/jobs/jobRecovery');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobResumeContextService } = require('../src/jobs/jobResumeContextService');
const { FREE_MODELS } = require('../src/providers/freeFirstProvider');

test('real PostgreSQL: automatic model routing, duplicate request, revisions and failure retention', async () => {
  const f = await createJobPostgresFixture(); let calls = 0, fail = false;
  const accessService = configuredOwnerJobAccess(f.pool, '101');
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const search = new JobSearchRepository(f.pool, { accessService }), profile = new JobProfileRepository(f.pool, { accessService }), drafts = new JobDraftRepository(f.pool, { accessService });
    const usage = new JobUsageRepository(f.pool);
    await search.ensure({ scope: f.scope });
    const vacancy = await search.upsertVacancy({ externalId: '777', snapshot: {
      title: 'Junior AI Engineer', company: 'Fixture', publishedAt: '2026-10-15T10:00:00Z', description: 'AI automation' } });
    await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
    await profile.replace({ scope: f.scope, expectedRevision: 0, profile: { confirmed: true,
      facts: [{ id: 'automation', text: 'Confirmed automation fixture', confirmed: true }], examples: [] } });
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'fixtureResume','connected')", [f.owner]);
    const resumeContextService = new JobResumeContextService({ pool: f.pool, accessService,
      browserClient: { forUser(userId) {
        assert.equal(userId, f.owner);
        return { async readResume({ resumeId }) {
          return { resumeId, title: 'Fixture engineer', experience: 'Built automation', skills: '',
            education: '', summary: '', grammaticalGender: 'unknown' };
        } };
      } } });
    const modelId = FREE_MODELS[0];
    const adapter = new JobModelAdapter({ config: { openrouterApiKey: crypto.randomUUID() }, fetchImpl: async (url, init) => {
      if (url.endsWith('/models/user')) return Response.json({ data: [{ id: modelId, context_length: 100000,
        pricing: { prompt: '0', completion: '0', request: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        supported_parameters: [] }] });
      if (url.endsWith('/key')) return Response.json({ data: { free_model_daily_requests: { remaining: 100 } } });
      calls++; const body = JSON.parse(init.body);
      assert.equal(body.model, modelId); assert.equal(body.usage.include, true); assert.equal(body.max_tokens, 3000);
      if (fail) throw new Error('Fixture disconnected');
      return Response.json({ id: `fixture-${calls}`, usage: { cost: 0 }, choices: [{ message: {
        content: JSON.stringify({ text: `Letter version ${calls}`, factIds: ['automation'] }) } }] });
    } });
    const service = new JobDraftService({ pool: f.pool, searchRepository: search, profileRepository: profile,
      draftRepository: drafts, usageRepository: usage, modelAdapter: adapter, accessService, resumeContextService });
    assert.equal(calls, 0);
    const requestId = crypto.randomUUID();
    const first = await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId });
    assert.equal(calls, 1);
    assert.equal((await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId })).id, first.id);
    assert.equal(calls, 1);
    const second = await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId: crypto.randomUUID(),
      parentDraftId: first.id, instruction: 'Shorter', language: 'ru' });
    assert.notEqual(first.id, second.id);
    assert.equal((await usage.getMonth({ userId: f.owner })).total, 0);
    fail = true;
    await assert.rejects(service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId: crypto.randomUUID(),
      parentDraftId: second.id, language: 'en' }), { code: 'JOB_MODEL_UNAVAILABLE' });
    assert.equal((await drafts.current({ userId: f.owner, vacancyId: vacancy.id })).id, second.id);
    fail = false;
    await service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId: crypto.randomUUID(), parentDraftId: second.id });
    assert.equal(calls, 4, 'generation continues after a failed request');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_budget_notices')).rows[0].n, 0);
    await assert.rejects(service.generate({ scope: { ...f.scope, userId: f.stranger }, vacancyId: vacancy.id,
      requestId: crypto.randomUUID() }));
    assert.equal(calls, 4);
    const interruptedId = crypto.randomUUID();
    await f.pool.query(`INSERT INTO job_tasks(user_id,request_id,kind,payload,status,created_at)
      VALUES($1,$2,'generate',$3,'running',now()-interval '4 minutes')`, [f.owner, interruptedId,
      { vacancyId: vacancy.id, parentDraftId: null, resumeId: 'fixtureResume', connectionRevision: 1, invoked: true }]);
    assert.equal(await recoverJobGenerations(f.pool), 1);
    assert.equal(await recoverJobGenerations(f.pool), 0);
    await assert.rejects(service.generate({ scope: f.scope, vacancyId: vacancy.id, requestId: interruptedId }), { code: 'JOB_GENERATION_OUTCOME_UNKNOWN' });
    assert.equal(calls, 4);
    console.log('PASS generation acceptance: scoped facts, model calls, dedup, versions, failures and zero-cost usage');
  } finally { await f.close(); }
});
