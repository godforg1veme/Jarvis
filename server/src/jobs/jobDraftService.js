const { assertJobScope, uuid, jobError } = require('./jobSchemas');
const { createHash } = require('node:crypto');
const { jobTransaction } = require('./jobTransaction');
const { buildJobPrompt, parseJobLetter } = require('./jobPrompt');

class JobDraftService {
  constructor({ pool, searchRepository, profileRepository, draftRepository, usageRepository, modelAdapter, now = () => new Date(), accessService = null, resumeContextService = null }) {
    Object.assign(this, { pool, searchRepository, profileRepository, draftRepository, usageRepository, modelAdapter, now, accessService, resumeContextService });
  }
  async createManual({ scope, vacancyId, mode, text, parentDraftId = null, expectedProfileRevision, expectedVacancyRevision }) {
    await assertJobScope(this.pool, scope, this.accessService);
    if (!['base', 'custom'].includes(mode) || typeof text !== 'string' || !text.trim() || text.length > 10000) throw jobError('JOB_INVALID_DRAFT');
    const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId });
    if (!vacancy) throw jobError('JOB_NOT_FOUND');
    const profile = await this.profileRepository.ensure({ scope });
    this.checkRevisions(profile, vacancy, expectedProfileRevision, expectedVacancyRevision);
    if (mode === 'base' && text !== profile.profile.baseLetter) throw jobError('JOB_REVISION_CONFLICT');
    return this.draftRepository.append({ scope, vacancyId, parentDraftId, profileRevision: profile.revision,
      vacancyRevision: vacancy.revision, text, facts: [], mode, sourceText: text });
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
        text, facts: draft.fact_ids || [], mode: 'custom', sourceText: text, preserveText: true, client });
    });
  }
  async generate({ scope, vacancyId, requestId, parentDraftId = null, instruction = '', language = 'auto', mode, sourceText,
    expectedProfileRevision, expectedVacancyRevision }) {
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
    const continuingDraft = mode == null;
    mode = mode || previous?.letter_mode || 'legacy_ai';
    if (mode === 'base') mode = 'improved';
    if (mode === 'custom') mode = 'custom_ai';
    if (!['legacy_ai', 'improved', 'custom_ai'].includes(mode)) throw jobError('JOB_INVALID_DRAFT');
    sourceText = sourceText ?? previous?.source_text ?? '';
    const resumeContext = this.resumeContextService ? await this.resumeContextService.getSelected({ scope }) : null;
    const messages = buildJobPrompt({ vacancy: vacancy.snapshot, profile: profile.profile, instruction, language, sourceText, resumeContext,
      previousText: continuingDraft ? previous?.text || '' : '' });
    const inputHash = createHash('sha256').update(JSON.stringify({ mode, sourceText, instruction, language })).digest('hex');
    const task = await jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-generate:${scope.userId}:${vacancyId}`]);
      const existing = (await client.query('SELECT * FROM job_tasks WHERE user_id=$1 AND request_id=$2', [scope.userId, requestId])).rows[0];
      if (existing) return existing;
      const running = await client.query(`SELECT id FROM job_tasks WHERE user_id=$1 AND status='running'
        AND payload->>'vacancyId'=$2`, [scope.userId, vacancyId]);
      if (running.rowCount) throw jobError('JOB_GENERATION_BUSY');
      return (await client.query(`INSERT INTO job_tasks(user_id,request_id,kind,payload,status)
        VALUES($1,$2,'generate',$3,'running') RETURNING *`, [scope.userId, requestId, { vacancyId, parentDraftId, mode, inputHash,
          resumeId: resumeContext?.resumeId || null, connectionRevision: resumeContext?.connectionRevision || null }])).rows[0];
    });
    if (task.payload.vacancyId !== vacancyId || task.payload.parentDraftId !== parentDraftId) throw jobError('JOB_INVALID_REQUEST');
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
      await this.usageRepository.record({ userId: scope.userId, requestId, outcome: 'pending', occurredAt: this.now() });
      const result = await this.modelAdapter.generate({ messages });
      await this.usageRepository.record({ userId: scope.userId, requestId, providerRequestId: result.requestId,
        costUsd: result.usage?.cost ?? null, outcome: 'success', occurredAt: this.now() });
      const letter = parseJobLetter(result.text, profile.profile);
      if (resumeContext) await this.resumeContextService.assertCurrent({ scope, resumeId: resumeContext.resumeId,
        connectionRevision: resumeContext.connectionRevision });
      const draft = await this.draftRepository.append({ scope, vacancyId, parentDraftId, profileRevision: profile.revision,
        vacancyRevision: vacancy.revision, text: letter.text, facts: letter.factIds, mode, sourceText,
        resumeId: resumeContext?.resumeId || null, connectionRevision: resumeContext?.connectionRevision || null });
      await this.pool.query("UPDATE job_tasks SET status='complete',result_id=$1 WHERE id=$2", [draft.id, task.id]);
      return draft;
    } catch (error) {
      await this.pool.query("UPDATE job_tasks SET status='failed' WHERE id=$1 AND status='running'", [task.id]);
      throw error;
    } finally {
      await this.usageRepository.claimBudgetNotice({ userId: scope.userId, now: this.now(), thresholdUsd: settings.settings.budgetUsd });
    }
  }
}
module.exports = { JobDraftService };
