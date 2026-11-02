const { createHash, randomUUID } = require('node:crypto');
const { assertJobScope, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');
const { normalizeQuestionnaire, normalizeAnswers } = require('../../../shared/jobQuestionnaire');
const { buildQuestionPrompt, parseQuestionAnswers, QUESTION_RESPONSE_FORMAT } = require('./jobQuestionPrompt');

class JobQuestionAnswerService {
  constructor({ pool, accessService, automationRepository, searchRepository, profileRepository,
    resumeContextService, modelAdapter, usageRepository }) {
    Object.assign(this, { pool, accessService, automationRepository, searchRepository, profileRepository,
      resumeContextService, modelAdapter, usageRepository });
  }
  async assertCurrent({ scope, draftId, automationRevision, versions, client = this.pool }) {
    await this.automationRepository.assertCurrent({ scope, revision: automationRevision,
      resumeId: versions.resumeId, connectionRevision: versions.connectionRevision, client });
    const row = (await client.query(`SELECT d.profile_revision,d.vacancy_revision,d.resume_id,d.connection_revision,
      p.revision AS profile_revision_now,v.revision AS vacancy_revision_now,s.revision AS search_revision,
      m.filter_revision,m.hidden FROM job_drafts d
      JOIN job_profiles p ON p.user_id=d.user_id JOIN job_vacancies v ON v.id=d.vacancy_id
      JOIN job_searches s ON s.user_id=d.user_id
      JOIN job_matches m ON m.user_id=d.user_id AND m.vacancy_id=d.vacancy_id
      WHERE d.id=$1 AND d.user_id=$2 AND d.current`, [draftId, scope.userId])).rows[0];
    if (!row || row.hidden || row.filter_revision !== row.search_revision
      || row.profile_revision !== versions.profileRevision || row.profile_revision_now !== versions.profileRevision
      || row.vacancy_revision !== versions.vacancyRevision || row.vacancy_revision_now !== versions.vacancyRevision
      || row.search_revision !== versions.searchRevision || row.resume_id !== versions.resumeId
      || row.connection_revision !== versions.connectionRevision) throw jobError('JOB_REVISION_CONFLICT');
  }
  async prepare({ scope, draftId, automationRevision, questionnaire }) {
    await assertJobScope(this.pool, scope, this.accessService);
    await this.automationRepository.assertCurrent({ scope, revision: automationRevision });
    questionnaire = normalizeQuestionnaire(questionnaire);
    const draft = (await this.pool.query('SELECT * FROM job_drafts WHERE id=$1 AND user_id=$2 AND current',
      [draftId, scope.userId])).rows[0];
    if (!draft) throw jobError('JOB_NOT_FOUND');
    const search = await this.searchRepository.getSettings({ userId: scope.userId });
    const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId: draft.vacancy_id });
    const profile = await this.profileRepository.ensure({ scope });
    const resumeContext = await this.resumeContextService.getSelected({ scope, requireComplete: true });
    if (!resumeContext || !vacancy || vacancy.hidden) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
    const versions = { profileRevision: profile.revision, vacancyRevision: vacancy.revision,
      searchRevision: search.revision, resumeId: resumeContext.resumeId,
      connectionRevision: resumeContext.connectionRevision, automationRevision };
    const input = { vacancy: vacancy.snapshot, profile: profile.profile, resumeContext,
      settings: search.settings, matchAnnotations: vacancy.annotations || [], questionnaire };
    const messages = buildQuestionPrompt(input);
    const inputHash = createHash('sha256').update(JSON.stringify({ versions, messages })).digest('hex');
    const requestId = `auto-answers:${randomUUID()}`;
    const task = await jobTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
      await this.assertCurrent({ scope, draftId, automationRevision, versions, client });
      const inserted = (await client.query(`INSERT INTO job_questionnaire_tasks
        (user_id,draft_id,request_id,input_hash,questionnaire,context_versions,status)
        VALUES($1,$2,$3,$4,$5,$6,'running') ON CONFLICT(user_id,draft_id,input_hash) DO NOTHING RETURNING *`,
      [scope.userId, draftId, requestId, inputHash, questionnaire, versions])).rows[0];
      return inserted ? { ...inserted, execute: true } : (await client.query(`SELECT * FROM job_questionnaire_tasks
        WHERE user_id=$1 AND draft_id=$2 AND input_hash=$3`, [scope.userId, draftId, inputHash])).rows[0];
    });
    const manual = () => ({ status: 'manual_required', failureCode: task.failure_code || 'JOB_HH_ANSWER_UNAVAILABLE' });
    if (!task?.execute) {
      await this.assertCurrent({ scope, draftId, automationRevision, versions });
      if (task?.status === 'complete') return { status: 'ready', questionnaire,
        answers: normalizeAnswers(questionnaire, task.answers), versions };
      if (task?.status === 'manual_required' || task?.status === 'failed') return manual();
      throw jobError('JOB_QUESTION_ANSWERS_UNKNOWN');
    }
    let invoked = false;
    try {
      await this.assertCurrent({ scope, draftId, automationRevision, versions });
      await this.usageRepository.record({ userId: scope.userId, requestId: task.request_id, outcome: 'pending' });
      invoked = true;
      const result = await this.modelAdapter.generate({ messages, maxTokens: 6000, responseFormat: QUESTION_RESPONSE_FORMAT });
      await this.usageRepository.record({ userId: scope.userId, requestId: task.request_id,
        providerRequestId: result.requestId, costUsd: result.usage?.cost ?? null,
        costBasis: result.usage?.costBasis || 'provider', outcome: 'success' });
      const parsed = parseQuestionAnswers(result, input);
      await this.assertCurrent({ scope, draftId, automationRevision, versions });
      const status = parsed.decision === 'answer' ? 'complete' : 'manual_required';
      const failureCode = status === 'complete' ? null : 'JOB_HH_ANSWER_UNAVAILABLE';
      await this.pool.query(`UPDATE job_questionnaire_tasks SET status=$2,answers=$3,failure_code=$4,updated_at=now()
        WHERE id=$1 AND user_id=$5 AND status='running'`,
      [task.id, status, JSON.stringify(parsed.answers), failureCode, scope.userId]);
      if (status !== 'complete') return { status: 'manual_required', failureCode };
      return { status: 'ready', questionnaire, answers: parsed.answers, versions };
    } catch (error) {
      if (error?.modelUsage) await this.usageRepository.record({ userId: scope.userId, requestId: task.request_id,
        providerRequestId: error.modelRequestId || null, costUsd: error.modelUsage.cost ?? null,
        costBasis: error.modelUsage.costBasis || 'provider', outcome: 'failed' });
      const invalid = ['JOB_MODEL_INVALID_OUTPUT','JOB_MODEL_INVALID_FACTS'].includes(error?.code);
      await this.pool.query(`UPDATE job_questionnaire_tasks SET status=$2,failure_code=$3,updated_at=now()
        WHERE id=$1 AND user_id=$4 AND status='running'`, [task.id, invalid || !invoked ? 'failed' : 'unknown',
        invalid ? 'JOB_HH_ANSWER_UNAVAILABLE' : 'JOB_QUESTION_ANSWERS_UNKNOWN', scope.userId]);
      if (invalid) return { status: 'manual_required', failureCode: 'JOB_HH_ANSWER_UNAVAILABLE' };
      throw error;
    } finally {
      await this.usageRepository.claimBudgetNotice({ userId: scope.userId, thresholdUsd: search.settings.budgetUsd }).catch(() => {});
    }
  }
}
module.exports = { JobQuestionAnswerService };
