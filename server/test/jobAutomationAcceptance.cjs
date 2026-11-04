const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobAutomationRepository } = require('../src/jobs/jobAutomationRepository');
const { JobAutomationService } = require('../src/jobs/jobAutomationService');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobApplicationRepository } = require('../src/jobs/jobApplicationRepository');
const { JobApplicationService } = require('../src/jobs/jobApplicationService');

test('real PG: personal consent gates candidate claims and revocation wins',
  { skip: !process.env.JARVIS_JOB_TEST_DATABASE_URL }, async () => {
    const f = await createJobPostgresFixture();
    try {
      await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
      const accessService = configuredOwnerJobAccess(f.pool, '101');
      const search = new JobSearchRepository(f.pool, { accessService });
      await search.ensure({ scope: f.scope });
      await f.pool.query(`UPDATE job_searches SET settings=settings||$2::jsonb WHERE user_id=$1`,
        [f.owner, { queries: ['node developer'], activated: true, paused: false }]);
      await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'resume-a','connected')", [f.owner]);
      const repository = new JobAutomationRepository(f.pool, { accessService });
      const service = new JobAutomationService({ pool: f.pool, repository, searchRepository: search,
        resumeContextService: { async selected() {
          const row = (await f.pool.query('SELECT resume_id,revision,status FROM job_connections WHERE user_id=$1', [f.owner])).rows[0];
          return row?.status === 'connected' ? row : null;
        } },
        accessService, available: true });
      assert.deepEqual(await service.get({ scope: f.scope }), { enabled: false, revision: 0, available: true, reason: null });
      const initial = await service.setEnabled({ scope: f.scope, enabled: true, expectedRevision: 0 });
      assert.equal(initial.revision, 1);
      const vacancy = await search.upsertVacancy({ externalId: '4321', snapshot: {
        externalId: '4321', title: 'Node developer', publishedAt: '2026-10-31T00:00:00.000Z',
        description: 'Personal project experience is useful', archived: false } });
      await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
      const item = await repository.claimCandidate();
      assert.equal(item.user_id, f.owner);
      assert.equal(item.vacancy_id, vacancy.id);
      assert.equal((await repository.claimCandidate()), null);
      const handoff = await repository.enqueueAttention({ scope: f.scope, vacancyId: vacancy.id,
        automationRevision: 1, code: 'MANUAL_REQUIRED' });
      assert.ok(handoff.id);
      assert.equal((await repository.enqueueAttention({ scope: f.scope, vacancyId: vacancy.id,
        automationRevision: 1, code: 'MANUAL_REQUIRED' })), null);
      await f.pool.query("UPDATE job_automation_items SET updated_at=now()-interval '11 minutes' WHERE id=$1", [item.id]);
      const interrupted = await repository.recoverInterrupted();
      assert.equal(interrupted.length, 1);
      assert.equal(interrupted[0].status, 'unknown');
      await f.pool.query("UPDATE job_connections SET status='disconnected' WHERE user_id=$1", [f.owner]);
      const prerequisites = await repository.claimPrerequisites();
      assert.equal(prerequisites.length, 1);
      assert.equal(prerequisites[0].code, 'LOGIN_REQUIRED');
      const notice = await repository.enqueueAttention({ scope: f.scope, vacancyId: null,
        automationRevision: 1, code: 'LOGIN_REQUIRED' });
      assert.ok(notice.id);
      await f.pool.query("UPDATE job_connections SET status='connected' WHERE user_id=$1", [f.owner]);
      await f.pool.query('UPDATE job_connections SET revision=revision+1 WHERE user_id=$1', [f.owner]);
      assert.deepEqual(await service.get({ scope: f.scope }), {
        enabled: true, revision: 1, available: false, reason: 'JOB_AUTOMATION_UNAVAILABLE' });
      const renewed = await service.setEnabled({ scope: f.scope, enabled: true, expectedRevision: 1 });
      assert.equal(renewed.revision, 2);
      assert.equal(renewed.available, true);
      const stopped = await service.setEnabled({ scope: f.scope, enabled: false, expectedRevision: 2 });
      assert.equal(stopped.enabled, false);
      await assert.rejects(repository.assertCurrent({ scope: f.scope, revision: 1 }), { code: 'JOB_AUTOMATION_UNAVAILABLE' });
      assert.equal((await repository.claimCandidate()), null);
      await assert.rejects(service.setEnabled({ scope: { ...f.scope, chatId: '999' }, enabled: true,
        expectedRevision: 2 }), { code: 'JOB_SCOPE_DENIED' });
    } finally { await f.close(); }
  });

test('real PG: autonomous sending uses consent, saves one operation and rejects stale candidates',
  { skip: !process.env.JARVIS_JOB_TEST_DATABASE_URL }, async () => {
    const f = await createJobPostgresFixture();
    try {
      await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
      const accessService = configuredOwnerJobAccess(f.pool, '101');
      const search = new JobSearchRepository(f.pool, { accessService });
      await search.ensure({ scope: f.scope });
      await f.pool.query('UPDATE job_searches SET settings=settings||$2::jsonb WHERE user_id=$1',
        [f.owner, { queries: ['node developer'], activated: true, paused: false }]);
      await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'resume-a','connected')", [f.owner]);
      const profiles = new JobProfileRepository(f.pool, { accessService });
      await profiles.ensure({ scope: f.scope });
      const drafts = new JobDraftRepository(f.pool, { accessService });
      const automation = new JobAutomationRepository(f.pool, { accessService });
      await automation.setEnabled({ scope: f.scope, enabled: true, expectedRevision: 0,
        resumeId: 'resume-a', connectionRevision: 1 });
      const snapshot = { externalId: '54321', title: 'Developer', company: 'Fixture',
        url: 'https://hh.ru/vacancy/54321', description: 'Adjacent skills',
        publishedAt: '2026-10-31T00:00:00.000Z', archived: false, manualRequired: false };
      const vacancy = await search.upsertVacancy({ externalId: snapshot.externalId, snapshot });
      await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
      const draft = await drafts.append({ scope: f.scope, vacancyId: vacancy.id,
        profileRevision: 1, vacancyRevision: 1, text: 'Honest fixture letter', facts: [],
        resumeId: 'resume-a', connectionRevision: 1 });
      let sends = 0;
      const adapter = { capabilities: { applicantApply: true },
        async inspect({ externalId }) { return { resumeAvailable: true, manualRequired: false,
          existingApplicationId: null, vacancy: { ...snapshot, externalId,
            url: `https://hh.ru/vacancy/${externalId}` } }; },
        async submit() { sends++; return { outcome: 'sent', verified: true, externalId: 'sent-54321' }; } };
      const applications = new JobApplicationService({ pool: f.pool,
        repository: new JobApplicationRepository(f.pool, { accessService }),
        searchRepository: search, adapter, accessService, automationRepository: automation });
      const results = await Promise.all([
        applications.submitAutomatic({ scope: f.scope, draftId: draft.id, automationRevision: 1 }),
        applications.submitAutomatic({ scope: f.scope, draftId: draft.id, automationRevision: 1 }),
      ]);
      assert.equal(sends, 1);
      assert.ok(results.some(x => x.status === 'sent'));
      const rows = (await f.pool.query('SELECT confirmation_id,automation_revision,status FROM job_applications')).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].confirmation_id, null);
      assert.equal(rows[0].automation_revision, 1);

      const stale = await search.upsertVacancy({ externalId: '54322', snapshot: {
        ...snapshot, externalId: '54322', url: 'https://hh.ru/vacancy/54322' } });
      await search.recordMatch({ userId: f.owner, vacancyId: stale.id, filterRevision: 1 });
      const staleDraft = await drafts.append({ scope: f.scope, vacancyId: stale.id,
        profileRevision: 1, vacancyRevision: 1, text: 'Second letter', facts: [],
        resumeId: 'resume-a', connectionRevision: 1 });
      await f.pool.query('UPDATE job_matches SET hidden=true WHERE user_id=$1 AND vacancy_id=$2', [f.owner, stale.id]);
      await assert.rejects(applications.submitAutomatic({ scope: f.scope, draftId: staleDraft.id,
        automationRevision: 1 }), { code: 'JOB_REVISION_CONFLICT' });
      const raceVacancy = await search.upsertVacancy({ externalId: '54323', snapshot: {
        ...snapshot, externalId: '54323', url: 'https://hh.ru/vacancy/54323' } });
      await search.recordMatch({ userId: f.owner, vacancyId: raceVacancy.id, filterRevision: 1 });
      const raceDraft = await drafts.append({ scope: f.scope, vacancyId: raceVacancy.id,
        profileRevision: 1, vacancyRevision: 1, text: 'Third letter', facts: [],
        resumeId: 'resume-a', connectionRevision: 1 });
      const gate = await f.pool.connect();
      try {
        await gate.query('BEGIN');
        await gate.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
        const pending = applications.submitAutomatic({ scope: f.scope, draftId: raceDraft.id,
          automationRevision: 1 });
        await new Promise(resolve => setTimeout(resolve, 30));
        await gate.query("DELETE FROM user_identities WHERE user_id=$1 AND provider='telegram'", [f.owner]);
        await gate.query('COMMIT');
        await assert.rejects(pending, { code: 'JOB_SCOPE_DENIED' });
      } finally { gate.release(); }
      await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
      await automation.setEnabled({ scope: f.scope, enabled: false, expectedRevision: 1 });
      assert.deepEqual(await applications.submitAutomatic({ scope: f.scope, draftId: staleDraft.id,
        automationRevision: 1 }), { status: 'cancelled', operationId: null, failureCode: 'JOB_AUTOMATION_UNAVAILABLE' });
      assert.equal((await applications.submitAutomatic({ scope: f.scope, draftId: draft.id,
        automationRevision: 1 })).status, 'sent', 'revocation cannot hide a saved result');
      const enabled = await automation.setEnabled({ scope: f.scope, enabled: true, expectedRevision: 2,
        resumeId: 'resume-a', connectionRevision: 1 });
      const inspect = adapter.inspect;
      adapter.inspect = async (...args) => {
        const result = await inspect(...args);
        await automation.setEnabled({ scope: f.scope, enabled: false, expectedRevision: enabled.revision });
        return result;
      };
      assert.deepEqual(await applications.submitAutomatic({ scope: f.scope, draftId: raceDraft.id,
        automationRevision: enabled.revision }), { status: 'cancelled', operationId: null,
        failureCode: 'JOB_AUTOMATION_UNAVAILABLE' });
      assert.equal((await f.pool.query('SELECT count(*)::int n FROM job_applications')).rows[0].n, 1);
      assert.equal(sends, 1);
    } finally { await f.close(); }
  });
