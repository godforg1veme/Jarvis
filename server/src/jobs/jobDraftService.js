const { assertJobScope, uuid, jobError } = require('./jobSchemas');
const { createHash } = require('node:crypto');
const { jobTransaction } = require('./jobTransaction');
const { buildJobPrompt } = require('./jobPrompt');
const { evaluateVacancy } = require('./jobFilters');
const { generateLetter, validationReason } = require('./jobLetterGeneration');

class JobDraftService {
  constructor({ pool, searchRepository, profileRepository, draftRepository, usageRepository, modelAdapter, now = () => new Date(), accessService = null, resumeContextService = null }) {
    Object.assign(this, { pool, searchRepository, profileRepository, draftRepository, usageRepository, modelAdapter, now, accessService, resumeContextService });
  }
  async createManual({ scope, vacancyId, mode, text, parentDraftId = null, replaceCurrentDraftId = null, expectedProfileRevision, expectedVacancyRevision }) {
    await assertJobScope(this.pool, scope, this.accessService);
    if (!['base', 'custom'].includes(mode) || typeof text !== 'string' || !text.trim() || text.length > 10000) throw jobError('JOB_INVALID_DRAFT');
    const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId });
    if (!vacancy) throw jobError('JOB_NOT_FOUND');
    const profile = await this.profileRepository.ensure({ scope });
    this.checkRevisions(profile, vacancy, expectedProfileRevision, expectedVacancyRevision);
    if (mode === 'base' && text !== profile.profile.baseLetter) throw jobError('JOB_REVISION_CONFLICT');
    return this.draftRepository.append({ scope, vacancyId, parentDraftId, profileRevision: profile.revision,
      vacancyRevision: vacancy.revision, text, facts: [], mode, sourceText: text, replaceCurrentDraftId });
  }
  checkRevisions(profile, vacancy, profileRevision, vacancyRevision) {
    if ((profileRevision != null && profile.revision !== profileRevision)
      || (vacancyRevision != null && vacancy.revision !== vacancyRevision)) throw jobError('JOB_REVISION_CONFLICT');
  }
  async replaceManual({ scope, draftId, text, interactionId, interactions }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw jobError('JOB_INVALID_LETTER');
    uuid.parse(draftId);
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      const draft = (await client.query('SELECT * FROM job_drafts WHERE id=$1 AND user_id=$2 AND current', [draftId, scope.userId])).rows[0];
      if (!draft) throw jobError('JOB_REVISION_CONFLICT');
      const consumed = await interactions.consume({ id: interactionId, ...scope, client });
      if (!consumed || consumed.kind !== 'job_draft_manual_edit' || consumed.context?.targetId !== draftId || consumed.context?.revision !== 1)
        throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
      return this.draftRepository.append({ scope, vacancyId: draft.vacancy_id, parentDraftId: draft.id,
        profileRevision: draft.profile_revision, vacancyRevision: draft.vacancy_revision,
        text, facts: draft.fact_ids || [], mode: 'custom', sourceText: text, preserveText: true, client,
        resumeId: draft.resume_id, connectionRevision: draft.connection_revision });
    });
  }
  async generate({ scope, vacancyId, requestId, parentDraftId = null, replaceCurrentDraftId = null, instruction = '', language = 'auto', mode, sourceText,
    expectedProfileRevision, expectedVacancyRevision, requireCompleteResume = false, automationRevision = null }) {
    await assertJobScope(this.pool, scope, this.accessService);
    uuid.parse(vacancyId);
    if (typeof requestId !== 'string' || !requestId || requestId.length > 150) throw jobError('JOB_INVALID_REQUEST');
    const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId });
    const profile = await this.profileRepository.ensure({ scope });
    const settings = await this.searchRepository.getSettings({ userId: scope.userId });
    if (!vacancy) throw jobError('JOB_NOT_FOUND');
    this.checkRevisions(profile, vacancy, expectedProfileRevision, expectedVacancyRevision);
    const previous = parentDraftId ? await this.draftRepository.get({ userId: scope.userId, draftId: parentDraftId }) : null;
    if (parentDraftId && (!previous?.current || previous.vacancy_id !== vacancyId)) throw jobError('JOB_REVISION_CONFLICT');
    if (replaceCurrentDraftId && parentDraftId) throw jobError('JOB_INVALID_DRAFT');
    const continuingDraft = mode == null;
    mode = mode || previous?.letter_mode || 'legacy_ai';
    if (mode === 'base') mode = 'improved';
    if (mode === 'custom') mode = 'custom_ai';
    if (!['legacy_ai', 'improved', 'custom_ai'].includes(mode)) throw jobError('JOB_INVALID_DRAFT');
    sourceText = sourceText ?? previous?.source_text ?? '';
    const resumeContext = this.resumeContextService ? await this.resumeContextService.getSelected({ scope,
      ...(requireCompleteResume ? { requireComplete: true } : {}) }) : null;
    if (previous && (!previous.resume_id || !previous.connection_revision
      || previous.resume_id !== resumeContext?.resumeId || previous.connection_revision !== resumeContext?.connectionRevision))
      throw jobError('JOB_DRAFT_RESUME_STALE');
    const filterResult = evaluateVacancy({ vacancy: vacancy.snapshot, settings: settings.settings });
    const messages = buildJobPrompt({ vacancy: vacancy.snapshot, profile: profile.profile, instruction, language, sourceText, resumeContext,
      searchSettings: settings.settings, filterResult, matchAnnotations: vacancy.annotations || [],
      previousText: continuingDraft ? previous?.text || '' : '' });
    const inputHash = createHash('sha256').update(JSON.stringify({ mode, sourceText, instruction, language, replaceCurrentDraftId })).digest('hex');
    const task = await jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-generate:${scope.userId}:${vacancyId}`]);
      const existing = (await client.query('SELECT * FROM job_tasks WHERE user_id=$1 AND request_id=$2', [scope.userId, requestId])).rows[0];
      if (existing) return existing;
      const running = await client.query(`SELECT id FROM job_tasks WHERE user_id=$1 AND status='running'
        AND payload->>'vacancyId'=$2`, [scope.userId, vacancyId]);
      if (running.rowCount) throw jobError('JOB_GENERATION_BUSY');
      return (await client.query(`INSERT INTO job_tasks(user_id,request_id,kind,payload,status)
        VALUES($1,$2,'generate',$3,'running') RETURNING *`, [scope.userId, requestId, { vacancyId, parentDraftId, replaceCurrentDraftId, mode, inputHash,
          resumeId: resumeContext?.resumeId || null, connectionRevision: resumeContext?.connectionRevision || null }])).rows[0];
    });
    if (task.payload.vacancyId !== vacancyId || task.payload.parentDraftId !== parentDraftId
      || (task.payload.replaceCurrentDraftId || null) !== replaceCurrentDraftId) throw jobError('JOB_INVALID_REQUEST');
    if (task.payload.mode && task.payload.mode !== mode) throw jobError('JOB_INVALID_REQUEST');
    if (task.payload.inputHash && task.payload.inputHash !== inputHash) throw jobError('JOB_INVALID_REQUEST');
    if (resumeContext && (task.payload.resumeId !== resumeContext.resumeId || task.payload.connectionRevision !== resumeContext.connectionRevision))
      throw jobError('JOB_REVISION_CONFLICT');
    if (task.status === 'complete') return this.draftRepository.get({ userId: scope.userId, draftId: task.result_id });
    if (task.status === 'unknown') throw jobError('JOB_GENERATION_OUTCOME_UNKNOWN');
    // An existing running request never starts another billable model call.
    if (task.request_id !== requestId || task.payload.parentDraftId !== parentDraftId) throw jobError('JOB_INVALID_REQUEST');
    const claimed = await this.pool.query(`UPDATE job_tasks SET status='running',payload=payload||'{"invoked":true}'::jsonb
      WHERE id=$1 AND NOT (payload ? 'invoked') RETURNING id`, [task.id]);
    if (!claimed.rowCount) throw jobError(task.status === 'failed' ? 'JOB_GENERATION_FAILED' : 'JOB_GENERATION_BUSY');
    try {
      await assertJobScope(this.pool, scope, this.accessService);
      const letter = await generateLetter({ messages, profile: profile.profile, requestId,
        allowRepair: requireCompleteResume && Number.isInteger(automationRevision),
        beforeCall: async ({ attempt, usageId }) => {
          await assertJobScope(this.pool, scope, this.accessService);
          if (Number.isInteger(automationRevision)) {
            const consent = await this.pool.query(`SELECT 1 FROM job_automations a
              JOIN job_connections c ON c.user_id=a.user_id JOIN job_searches s ON s.user_id=a.user_id
              WHERE a.user_id=$1 AND a.enabled AND a.revision=$2 AND a.conversation_id=$3 AND a.chat_id=$4
                AND c.status='connected' AND c.resume_id=a.resume_id AND c.revision=a.connection_revision
                AND c.resume_id=$5 AND c.revision=$6 AND s.revision=$7
                AND s.conversation_id=a.conversation_id AND s.chat_id=a.chat_id
                AND s.settings->>'activated'='true' AND s.settings->>'paused'='false'`,
            [scope.userId, automationRevision, scope.conversationId, scope.chatId,
              resumeContext?.resumeId, resumeContext?.connectionRevision, settings.revision]);
            if (!consent.rowCount) throw jobError('JOB_AUTOMATION_UNAVAILABLE');
          }
          if (attempt) {
            const claimedRepair = await this.pool.query(`UPDATE job_tasks
              SET payload=payload||'{"repairInvoked":true}'::jsonb WHERE id=$1 AND status='running'
              AND NOT (payload ? 'repairInvoked') RETURNING id`, [task.id]);
            if (!claimedRepair.rowCount) throw jobError('JOB_GENERATION_OUTCOME_UNKNOWN');
          }
          await this.usageRepository.record({ userId: scope.userId, requestId: usageId,
            outcome: 'pending', occurredAt: this.now() });
        },
        invoke: input => this.modelAdapter.generate(input),
        onInvalid: value => this.pool.query(`UPDATE job_tasks SET payload=payload||$2::jsonb
          WHERE id=$1 AND status='running'`, [task.id, { modelValidationFailure: value.reason,
          modelValidationField: value.field, validationAttempt: value.attempt + 1 }]),
        record: ({ usageId, result }) => this.usageRepository.record({ userId: scope.userId,
          requestId: usageId, providerRequestId: result.requestId, costUsd: result.usage?.cost ?? null,
          costBasis: result.usage?.costBasis || 'provider', outcome: 'success', occurredAt: this.now() }),
      });
      if (resumeContext) await this.resumeContextService.assertCurrent({ scope, resumeId: resumeContext.resumeId,
        connectionRevision: resumeContext.connectionRevision });
      const draft = await this.draftRepository.append({ scope, vacancyId, parentDraftId, profileRevision: profile.revision,
        vacancyRevision: vacancy.revision, text: letter.text, facts: letter.factIds, mode, sourceText,
        resumeId: resumeContext?.resumeId || null, connectionRevision: resumeContext?.connectionRevision || null, replaceCurrentDraftId });
      await this.pool.query("UPDATE job_tasks SET status='complete',result_id=$1 WHERE id=$2", [draft.id, task.id]);
      return draft;
    } catch (error) {
      if (error.modelUsage) await this.usageRepository.record({ userId: scope.userId, requestId: error.letterUsageId || requestId,
        providerRequestId: error.modelRequestId, costUsd: error.modelUsage.cost ?? null,
        costBasis: error.modelUsage.costBasis || 'provider', outcome: 'failed', occurredAt: this.now() });
      const validationFailure = validationReason(error)
        || (error.code === 'JOB_LETTER_VALIDATION_FAILED' ? error.validationReason : null);
      const uncertainCall = Boolean(error.letterUsageId && !validationFailure)
        || error.code === 'JOB_GENERATION_OUTCOME_UNKNOWN';
      const metadata = uncertainCall ? { modelCallOutcome: 'unknown', modelValidationFailure: null }
        : validationFailure ? { modelValidationFailure: validationFailure,
          modelValidationField: ['text','factIds','status','object'].includes(error.validationField) ? error.validationField : null } : {};
      await this.pool.query("UPDATE job_tasks SET status=$3,payload=payload||$2::jsonb WHERE id=$1 AND status='running'",
        [task.id, metadata, uncertainCall ? 'unknown' : 'failed']);
      throw error;
    } finally {
      await this.usageRepository.claimBudgetNotice({ userId: scope.userId, now: this.now(), thresholdUsd: settings.settings.budgetUsd });
    }
  }
}
module.exports = { JobDraftService };
