const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobAutomationRepository } = require('../src/jobs/jobAutomationRepository');
const { JobApplicationRepository } = require('../src/jobs/jobApplicationRepository');
const { JobApplicationService } = require('../src/jobs/jobApplicationService');
const { JobAutomationWorker } = require('../src/jobs/jobAutomationWorker');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobUsageRepository } = require('../src/jobs/jobUsageRepository');
const { JobDraftService } = require('../src/jobs/jobDraftService');
const fs = require('node:fs/promises');
const path = require('node:path');

async function fixture() {
  const f = await createJobPostgresFixture();
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
  const accessService = configuredOwnerJobAccess(f.pool, '101');
  const v = (await f.pool.query("INSERT INTO job_vacancies(source,external_id,snapshot,content_hash,published_at) VALUES('hh','123',$1,'fixture',now()) RETURNING id",
    [{ title: 'Fixture', description: 'Fixture' }])).rows[0].id;
  const d = (await f.pool.query(`INSERT INTO job_drafts(user_id,vacancy_id,profile_revision,vacancy_revision,text,fact_ids)
    VALUES($1,$2,1,1,'Approved letter','[]') RETURNING id`, [f.owner, v])).rows[0].id;
  await f.pool.query("INSERT INTO job_connections(user_id,status,resume_id) VALUES($1,'connected','fixtureResume')", [f.owner]);
  const operationId = randomUUID();
  const app = (await f.pool.query(`INSERT INTO job_applications(user_id,vacancy_id,resume_id,draft_id,
    automation_revision,operation_id,approved_text,status,origin_conversation_id,origin_chat_id,origin_connection_revision)
    VALUES($1,$2,'fixtureResume',$3,1,$4,'Approved letter','unknown',$5,'101',1) RETURNING *`,
  [f.owner, v, d, operationId, f.scope.conversationId])).rows[0];
  const item = (await f.pool.query(`INSERT INTO job_automation_items(user_id,vacancy_id,automation_revision,status,
    operation_id,evaluation_request_id,draft_request_id) VALUES($1,$2,1,'unknown',$3,'fixture-eval','fixture-letter') RETURNING id`,
  [f.owner, v, operationId])).rows[0];
  const repository = new JobAutomationRepository(f.pool, { accessService });
  return { ...f, app, item, operationId, repository, accessService };
}
test('PG reconciliation leases one original operation, resolves after off and never submits', async () => {
  const f = await fixture();
  try {
    let reads = 0;
    const service = new JobApplicationService({ pool: f.pool, accessService: f.accessService,
      repository: new JobApplicationRepository(f.pool, { accessService: f.accessService }),
      adapter: { capabilities: { applicantApply: true }, async submit() { assert.fail('second submit forbidden'); },
        async reconcile(input) { reads++; assert.equal(input.operationId, f.operationId); assert.equal(input.letter, 'Approved letter');
          return { outcome: 'sent', verified: true, externalId: '444' }; } } });
    // No enabled automation exists: read-only result verification is independent of submit consent.
    const claims = await Promise.all([f.repository.claimReconciliation(), f.repository.claimReconciliation()]);
    const claim = claims.find(Boolean); assert.equal(claims.filter(Boolean).length, 1);
    const worker = new JobAutomationWorker({ pool: f.pool, repository: f.repository, applicationService: service });
    await worker.reconcileDue(claim); assert.equal(reads, 1);
    assert.equal((await f.pool.query('SELECT status FROM job_applications WHERE operation_id=$1', [f.operationId])).rows[0].status, 'sent');
    assert.equal((await f.pool.query('SELECT status FROM job_automation_items WHERE id=$1', [f.item.id])).rows[0].status, 'sent');
    assert.equal(await f.repository.claimReconciliation(), null);
  } finally { await f.close(); }
});
test('PG reconciliation atomically commits application and item, rolling both back on item failure', async () => {
  const f = await fixture();
  try {
    const service = new JobApplicationService({ pool: f.pool, accessService: f.accessService,
      repository: new JobApplicationRepository(f.pool, { accessService: f.accessService }),
      adapter: { capabilities: { applicantApply: true }, async submit() { assert.fail('resend forbidden'); },
        async reconcile() { return { outcome: 'sent', verified: true, externalId: '444' }; } } });
    await f.pool.query(`CREATE FUNCTION reject_item_result() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture write failure'; END $$;
      CREATE TRIGGER reject_item_result BEFORE UPDATE ON job_automation_items
        FOR EACH ROW EXECUTE FUNCTION reject_item_result()`);
    await assert.rejects(service.reconcile({ scope: f.scope, operationId: f.operationId }));
    assert.equal((await f.pool.query('SELECT status FROM job_applications')).rows[0].status, 'unknown');
    await f.pool.query('DROP TRIGGER reject_item_result ON job_automation_items');
    await service.reconcile({ scope: f.scope, operationId: f.operationId });
    assert.equal((await f.pool.query('SELECT status FROM job_automation_items')).rows[0].status, 'sent');
  } finally { await f.close(); }
});

test('PG known original result heals interrupted queue after off and connection change without HH reads', async () => {
  const f = await fixture();
  try {
    await f.pool.query("UPDATE job_applications SET status='sent'");
    await f.pool.query("UPDATE job_automation_items SET status='submitting',operation_id=NULL");
    await f.pool.query("UPDATE job_connections SET revision=revision+1,status='disconnected'");
    assert.equal(await f.repository.claimReconciliation(), null);
    const item = (await f.pool.query('SELECT status,operation_id FROM job_automation_items')).rows[0];
    assert.equal(item.status, 'sent'); assert.equal(item.operation_id, f.operationId);
    await f.pool.query("UPDATE job_automation_items SET status='unknown',operation_id=$1", [randomUUID()]);
    await f.repository.claimReconciliation();
    assert.equal((await f.pool.query('SELECT status FROM job_automation_items')).rows[0].status, 'unknown');
  } finally { await f.close(); }
});

test('PG terminal scan advances past twenty denied scopes without changing them', async () => {
  const f = await fixture();
  try {
    await f.pool.query("UPDATE job_applications SET status='sent'");
    for (let i = 0; i < 20; i++) {
      const v = (await f.pool.query(`INSERT INTO job_vacancies(source,external_id,snapshot,content_hash,published_at)
        VALUES('hh',$1,'{}','fixture',now()) RETURNING id`, [String(1000 + i)])).rows[0].id;
      const op = randomUUID();
      await f.pool.query(`INSERT INTO job_applications(user_id,vacancy_id,resume_id,draft_id,
        automation_revision,operation_id,approved_text,status,origin_conversation_id,origin_chat_id,origin_connection_revision)
        VALUES($1,$2,'fixtureResume',$3,1,$4,'Approved letter','sent',$5,'101',1)`,
      [f.owner,v,f.app.draft_id,op,f.scope.conversationId]);
      await f.pool.query(`INSERT INTO job_automation_items(user_id,vacancy_id,automation_revision,status,
        operation_id,evaluation_request_id,draft_request_id) VALUES($1,$2,1,'unknown',$3,$4,$5)`,
      [f.owner,v,op,`scan-eval-${i}`,`scan-letter-${i}`]);
    }
    let checks = 0;
    const repository = new JobAutomationRepository(f.pool, { accessService: { repository: {
      get: (...args) => ++checks <= 20 ? null : f.accessService.repository.get(...args) } } });
    await repository.claimReconciliation();
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM job_automation_items WHERE status='sent'")).rows[0].n, 0);
    await repository.claimReconciliation();
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM job_automation_items WHERE status='sent'")).rows[0].n, 1);
  } finally { await f.close(); }
});

test('PG reconciliation preserves unknown, caps six reads and rejects changed connection/access', async () => {
  const f = await fixture();
  try {
    for (let i = 1; i <= 6; i++) {
      const claim = await f.repository.claimReconciliation(); assert.equal(claim.reconciliation_attempts, i);
      assert.equal(await f.repository.claimReconciliation(), null);
      assert.equal(await f.repository.finishReconciliation({ operationId: f.operationId, token: randomUUID() }), null);
      await f.repository.finishReconciliation({ operationId: f.operationId, token: claim.reconciliation_token });
      await f.pool.query("UPDATE job_applications SET reconciliation_after=now()-interval '1 second'");
    }
    assert.equal(await f.repository.claimReconciliation(), null);
    const exhausted = (await f.pool.query('SELECT status,failure_code FROM job_applications')).rows[0];
    assert.equal(exhausted.status, 'unknown'); assert.equal(exhausted.failure_code, 'JOB_RECONCILIATION_EXHAUSTED');
    await f.pool.query('UPDATE job_applications SET reconciliation_attempts=0');
    await f.pool.query('UPDATE job_connections SET revision=revision+1');
    assert.equal(await f.repository.claimReconciliation(), null);
    await f.pool.query('UPDATE job_connections SET revision=1');
    const denied = new JobAutomationRepository(f.pool, { accessService: { repository: { async get() { return null; } } } });
    assert.equal(await denied.claimReconciliation(), null);
  } finally { await f.close(); }
});

test('PG connection or access revoked while reading cannot commit a verified result', async () => {
  const f = await fixture();
  try {
    let allowed = true, mode = 'connection';
    const accessService = { repository: { get: (...args) => allowed ? f.accessService.repository.get(...args) : null } };
    const service = new JobApplicationService({ pool: f.pool, accessService,
      repository: new JobApplicationRepository(f.pool, { accessService }),
      adapter: { capabilities: { applicantApply: true }, async reconcile() {
        if (mode === 'connection') await f.pool.query('UPDATE job_connections SET revision=revision+1');
        else allowed = false;
        return { outcome: 'sent', verified: true, externalId: '444' };
      } } });
    await assert.rejects(service.reconcile({ scope: f.scope, operationId: f.operationId }), { code: 'JOB_REVISION_CONFLICT' });
    await f.pool.query('UPDATE job_connections SET revision=1'); mode = 'access';
    await assert.rejects(service.reconcile({ scope: f.scope, operationId: f.operationId }), { code: 'JOB_SCOPE_DENIED' });
    assert.equal((await f.pool.query('SELECT status FROM job_applications')).rows[0].status, 'unknown');
  } finally { await f.close(); }
});

test('PG legacy origin uses only exact private delivery scope; known invalid non-send is not left unknown', async () => {
  const f = await fixture();
  try {
    const sql = await fs.readFile(path.join(__dirname, '../src/db/migrations/058_job_result_reconciliation.sql'), 'utf8');
    const backfill = sql.match(/WITH saved_origins AS \([\s\S]*?FROM saved_origins s WHERE app.id=s.id;/)[0];
    await f.pool.query('UPDATE job_applications SET origin_conversation_id=NULL,origin_chat_id=NULL');
    const payload = { reason: 'HH_AUTO_ATTENTION', code: 'RESULT_UNKNOWN', vacancyId: f.app.vacancy_id,
      automationRevision: 2, conversationId: f.scope.conversationId, chatId: '101' };
    await f.pool.query(`INSERT INTO job_deliveries(user_id,vacancy_id,kind,dedup_key,payload)
      VALUES($1,$2,'attention','wrong-revision',$3)`, [f.owner,f.app.vacancy_id,payload]);
    await f.pool.query(backfill);
    assert.equal((await f.pool.query('SELECT origin_chat_id FROM job_applications')).rows[0].origin_chat_id, null);
    await f.pool.query(`INSERT INTO job_deliveries(user_id,vacancy_id,kind,dedup_key,payload)
      VALUES($1,$2,'attention','correct-origin',$3)`, [f.owner,f.app.vacancy_id,{ ...payload, automationRevision: 1 }]);
    await f.pool.query(backfill);
    assert.equal((await f.pool.query('SELECT origin_chat_id FROM job_applications')).rows[0].origin_chat_id, '101');
    // A validation marker cannot downgrade a real uncertain external operation.
    await f.pool.query(`INSERT INTO job_tasks(user_id,request_id,kind,payload,status)
      VALUES($1,'fixture-letter','generate','{"modelValidationFailure":"schema"}','failed')`,[f.owner]);
    const classify = sql.match(/UPDATE job_automation_items i SET status='manual_required'[\s\S]*?i.vacancy_id\);/)[0];
    await f.pool.query(classify);
    assert.equal((await f.pool.query('SELECT status FROM job_automation_items')).rows[0].status, 'unknown');
    await f.pool.query('DELETE FROM job_applications');
    await f.pool.query('UPDATE job_automation_items SET operation_id=NULL');
    await f.pool.query(classify);
    const item = (await f.pool.query('SELECT status,failure_phase,failure_code FROM job_automation_items')).rows[0];
    assert.equal(item.status, 'manual_required'); assert.equal(item.failure_phase, 'generation');
    assert.equal(item.failure_code, 'JOB_LETTER_VALIDATION_REVIEW');
  } finally { await f.close(); }
});

test('PG automatic letter persists one repair, two billed requests and replay never repeats either', async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const search = new JobSearchRepository(f.pool, { accessService });
    const profiles = new JobProfileRepository(f.pool, { accessService });
    await search.ensure({ scope: f.scope });
    await f.pool.query(`UPDATE job_searches SET settings=settings||'{"activated":true,"paused":false}'::jsonb WHERE user_id=$1`, [f.owner]);
    await profiles.replace({ scope: f.scope, expectedRevision: 0, profile: { confirmed: true, facts: [], examples: [] } });
    const vacancy = await search.upsertVacancy({ externalId: '777', snapshot: {
      title: 'AI engineer', description: 'Develop integrations', publishedAt: '2026-11-04T00:00:00Z' } });
    await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'fixtureResume','connected')", [f.owner]);
    const automation = new JobAutomationRepository(f.pool, { accessService });
    const consent = await automation.setEnabled({ scope: f.scope, enabled: true, expectedRevision: 0,
      resumeId: 'fixtureResume', connectionRevision: 1 });
    const drafts = new JobDraftRepository(f.pool, { accessService }); let calls = 0, transportFailure = false;
    const service = new JobDraftService({ pool: f.pool, accessService, searchRepository: search,
      profileRepository: profiles, draftRepository: drafts, usageRepository: new JobUsageRepository(f.pool),
      resumeContextService: { async getSelected() { return { resumeId: 'fixtureResume', connectionRevision: 1,
        snapshot: { resumeId: 'fixtureResume', title: 'Engineer', experience: 'Built integrations',
          skills: '', education: '', summary: '', grammaticalGender: 'unknown' } }; }, async assertCurrent() {} },
      modelAdapter: { async generate() {
        calls++; if (transportFailure && calls % 2 === 0) throw Object.assign(Error(), { code: 'JOB_MODEL_UNAVAILABLE' });
        return { text: calls % 2 ? '{}' : JSON.stringify({ status: 'ready', text: 'Approved letter', factIds: [] }),
          finishReason: 'stop', requestId: `fixture-${calls}`, usage: { cost: 0.001, costBasis: 'provider' } };
      } } });
    const input = { scope: f.scope, vacancyId: vacancy.id, requestId: 'auto-letter:fixture',
      mode: 'improved', sourceText: '', requireCompleteResume: true, automationRevision: consent.revision };
    const draft = await service.generate(input); assert.equal(calls, 2); assert.equal(draft.text, 'Approved letter');
    assert.equal((await service.generate(input)).id, draft.id); assert.equal(calls, 2);
    const task = (await f.pool.query('SELECT payload FROM job_tasks WHERE request_id=$1', [input.requestId])).rows[0];
    assert.equal(task.payload.repairInvoked, true);
    const usage = (await f.pool.query('SELECT count(*)::int AS n,sum(cost_usd)::float8 AS cost FROM job_usage')).rows[0];
    assert.equal(usage.n, 2); assert.equal(usage.cost, 0.002);
    transportFailure = true;
    const interrupted = { ...input, parentDraftId: draft.id, requestId: 'auto-letter:unknown-repair' };
    await assert.rejects(service.generate(interrupted), { code: 'JOB_MODEL_UNAVAILABLE' });
    assert.equal(calls, 4);
    await assert.rejects(service.generate(interrupted), { code: 'JOB_GENERATION_OUTCOME_UNKNOWN' });
    assert.equal(calls, 4);
    assert.equal((await f.pool.query('SELECT status FROM job_tasks WHERE request_id=$1', [interrupted.requestId])).rows[0].status, 'unknown');
  } finally { await f.close(); }
});
