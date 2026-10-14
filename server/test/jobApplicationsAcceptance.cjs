const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobApplicationRepository } = require('../src/jobs/jobApplicationRepository');
const { JobApplicationService } = require('../src/jobs/jobApplicationService');

async function applicationFixture() {
  const f = await createJobPostgresFixture();
  const search = new JobSearchRepository(f.pool), profile = new JobProfileRepository(f.pool), drafts = new JobDraftRepository(f.pool);
  const clock = { now: new Date('2026-10-15T12:00:00Z') };
  const repository = new JobApplicationRepository(f.pool, { now: () => clock.now });
  let submits = 0, existing = null, rejectedResume = false, manual = false, changed = false, submitResult = { outcome: 'sent', externalId: 'fixture-response', verified: true };
  const snapshot = { externalId: '123', title: 'AI Engineer', company: 'Fixture', url: 'https://hh.ru/vacancy/123',
    description: 'Fixture tasks', publishedAt: '2026-10-15T00:00:00Z', archived: false, manualRequired: false };
  await search.ensure({ scope: f.scope });
  await profile.replace({ scope: f.scope, expectedRevision: 0, profile: { confirmed: true,
    facts: [{ id: 'fixture', text: 'Confirmed example', confirmed: true }], examples: [] } });
  const vacancy = await search.upsertVacancy({ externalId: '123', snapshot });
  await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
  await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'fixture-resume','connected')", [f.owner]);
  const draft = await drafts.append({ scope: f.scope, vacancyId: vacancy.id, profileRevision: 1, vacancyRevision: 1, text: 'Approved fixture letter', facts: ['fixture'] });
  const adapter = { capabilities: { applicantApply: true },
    async inspect() { return { resumeAvailable: !rejectedResume, manualRequired: manual,
      existingApplicationId: existing, vacancy: changed ? { ...snapshot, description: 'Changed tasks' } : snapshot }; },
    async submit({ operationId, letter }) {
      submits++; assert.equal(letter, draft.text);
      const persisted = await f.pool.query("SELECT status FROM job_applications WHERE operation_id=$1", [operationId]);
      assert.equal(persisted.rows[0].status, 'sending', 'durable intent must exist before external POST');
      if (submitResult instanceof Error) throw submitResult;
      return submitResult;
    }, async reconcile() { return { outcome: 'unknown' }; } };
  const service = new JobApplicationService({ pool: f.pool, repository, searchRepository: search, adapter });
  const prepare = async () => {
    const reply = await service.prepareConfirmation({ scope: f.scope, draftId: draft.id });
    const id = reply.buttons?.[0]?.[0]?.data.split(':').pop();
    return { reply, id };
  };
  return { ...f, search, profile, drafts, draft, vacancy, clock, repository, service, adapter, prepare,
    get submits() { return submits; },
    setSubmitResult(value) { submitResult = value; }, setExisting(value) { existing = value; },
    rejectResume() { rejectedResume = true; }, requireManual() { manual = true; }, changeVacancy() { changed = true; } };
}

test('real PG: concurrent confirmations submit once; replay returns original result', async () => {
  const f = await applicationFixture();
  try {
    const { reply, id } = await f.prepare(); assert.equal(f.submits, 0);
    assert.ok(reply.answer.includes(f.draft.text)); assert.match(reply.answer, /fixture-resume/);
    const outcomes = await Promise.all([f.service.confirm({ scope: f.scope, confirmationId: id }), f.service.confirm({ scope: f.scope, confirmationId: id })]);
    assert.equal(f.submits, 1); assert.ok(outcomes.every((x) => ['sent', 'sending'].includes(x.applicationStatus)));
    const again = await f.service.confirm({ scope: f.scope, confirmationId: id }); assert.equal(again.applicationStatus, 'sent');
    assert.equal(f.submits, 1);
  } finally { await f.close(); }
});

test('real PG: expired, foreign, cancelled and superseded letters cannot submit', async () => {
  const f = await applicationFixture();
  try {
    let prepared = await f.prepare();
    await assert.rejects(f.service.confirm({ scope: { ...f.scope, userId: f.stranger }, confirmationId: prepared.id }), { code: 'JOB_SCOPE_DENIED' });
    await assert.rejects(f.service.confirm({ scope: { ...f.scope, chatId: '999' }, confirmationId: prepared.id }));
    f.clock.now = new Date(f.clock.now.getTime() + 600001);
    await assert.rejects(f.service.confirm({ scope: f.scope, confirmationId: prepared.id }), { code: 'JOB_CONFIRMATION_UNAVAILABLE' });
    prepared = await f.prepare();
    await f.pool.query("UPDATE job_confirmations SET status='cancelled' WHERE id=$1", [prepared.id]);
    await assert.rejects(f.service.confirm({ scope: f.scope, confirmationId: prepared.id }));
    prepared = await f.prepare();
    await f.drafts.append({ scope: f.scope, vacancyId: f.vacancy.id, parentDraftId: f.draft.id,
      profileRevision: 1, vacancyRevision: 1, text: 'New version invalidates earlier consent', facts: ['fixture'] });
    await assert.rejects(f.service.confirm({ scope: f.scope, confirmationId: prepared.id }));
    assert.equal(f.submits, 0);
  } finally { await f.close(); }
});

test('real PG: resume/profile/source changes, removed resume and external form prevent sending', async () => {
  for (const mode of ['connection', 'profile', 'vacancy', 'resume', 'manual', 'existing']) {
    const f = await applicationFixture();
    try {
      const { id } = await f.prepare();
      if (mode === 'connection') await f.pool.query('UPDATE job_connections SET revision=revision+1 WHERE user_id=$1', [f.owner]);
      if (mode === 'profile') await f.profile.replace({ scope: f.scope, expectedRevision: 1,
        profile: { confirmed: true, facts: [], examples: [] } });
      if (mode === 'vacancy') f.changeVacancy();
      if (mode === 'resume') f.rejectResume();
      if (mode === 'manual') f.requireManual();
      if (mode === 'existing') f.setExisting('existing-fixture');
      const result = await f.service.confirm({ scope: f.scope, confirmationId: id }).catch((error) => error);
      assert.notEqual(result.applicationStatus, 'sent'); assert.equal(f.submits, 0, mode);
    } finally { await f.close(); }
  }
});

test('real PG: unknown result never repeats POST; reconciliation keeps the original operation', async () => {
  const f = await applicationFixture();
  try {
    const { id } = await f.prepare();
    f.setSubmitResult(new Error('Fixture transport lost the response'));
    const unknown = await f.service.confirm({ scope: f.scope, confirmationId: id });
    assert.equal(unknown.applicationStatus, 'unknown'); assert.equal(f.submits, 1);
    const pending = await f.service.confirm({ scope: f.scope, confirmationId: id });
    assert.equal(pending.operationId, unknown.operationId); assert.equal(pending.applicationStatus, 'unknown'); assert.equal(f.submits, 1);
    const newerConfirmation = await f.prepare();
    const stillPending = await f.service.confirm({ scope: f.scope, confirmationId: newerConfirmation.id });
    assert.equal(stillPending.operationId, unknown.operationId); assert.equal(f.submits, 1);
    await f.pool.query("UPDATE job_connections SET resume_id='other-fixture-resume',revision=revision+1 WHERE user_id=$1", [f.owner]);
    const anotherResume = await f.prepare();
    const sameUnknown = await f.service.confirm({ scope: f.scope, confirmationId: anotherResume.id });
    assert.equal(sameUnknown.operationId, unknown.operationId, 'changing the primary resume must not bypass an unknown submission');
    assert.equal(f.submits, 1);
    f.adapter.reconcile = async ({ operationId }) => { assert.equal(operationId, unknown.operationId); return { outcome: 'sent', verified: true, externalId: 'verified-fixture' }; };
    const verified = await f.service.reconcile({ scope: f.scope, operationId: unknown.operationId });
    assert.equal(verified.applicationStatus, 'sent'); assert.equal(f.submits, 1);
  } finally { await f.close(); }
});

test('real PG: restart marks orphan sending as unknown; unverified acknowledgements cannot claim success', async () => {
  const f = await applicationFixture();
  const { JobRecoveryWorker } = require('../src/jobs/jobRecovery');
  const recovery = new JobRecoveryWorker({ pool: f.pool, applicationRepository: f.repository, intervalMs: 10 });
  try {
    const { id } = await f.prepare();
    const claim = await f.repository.claim({ scope: f.scope, confirmationId: id }); assert.equal(claim.execute, true);
    await recovery.start();
    assert.equal((await f.repository.get({ scope: f.scope, operationId: claim.operation.operation_id })).status, 'sending');
    await f.pool.query("UPDATE job_applications SET updated_at=now()-interval '3 minutes' WHERE operation_id=$1", [claim.operation.operation_id]);
    for (let attempts = 0; attempts < 100; attempts++) {
      if ((await f.repository.get({ scope: f.scope, operationId: claim.operation.operation_id })).status === 'unknown') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await f.repository.get({ scope: f.scope, operationId: claim.operation.operation_id })).status, 'unknown');
    assert.equal(f.submits, 0);
    f.adapter.reconcile = async () => ({ outcome: 'sent', externalId: crypto.randomUUID() });
    assert.equal((await f.service.reconcile({ scope: f.scope, operationId: claim.operation.operation_id })).applicationStatus, 'unknown');
  } finally { await recovery.close(); await f.close(); }
});

test('production default blocks applicant submission without a verified connector capability', async () => {
  const f = await applicationFixture();
  try {
    const disabled = new JobApplicationService({ pool: f.pool, repository: f.repository, searchRepository: f.search });
    await assert.rejects(disabled.prepareConfirmation({ scope: f.scope, draftId: f.draft.id }), { code: 'JOB_APPLICANT_API_UNAVAILABLE' });
    assert.equal(f.submits, 0);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_applications')).rows[0].n, 0);
  } finally { await f.close(); }
});
