const { assertJobScope, uuid, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');
const { buildJobPrompt, parseJobLetter } = require('./jobPrompt');

class JobDraftService {
  constructor({ pool, searchRepository, profileRepository, draftRepository, usageRepository, modelAdapter, defaultModel = '', now = () => new Date() }) {
    Object.assign(this, { pool, searchRepository, profileRepository, draftRepository, usageRepository, modelAdapter, defaultModel, now });
  }
  async generate({ scope, vacancyId, requestId, parentDraftId = null, instruction = '', language = 'auto' }) {
    await assertJobScope(this.pool, scope);
    uuid.parse(vacancyId);
    if (typeof requestId !== 'string' || !requestId || requestId.length > 150) throw jobError('JOB_INVALID_REQUEST');
    const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId });
    const profile = await this.profileRepository.get({ userId: scope.userId });
    const settings = await this.searchRepository.getSettings({ userId: scope.userId });
    if (!vacancy) throw jobError('JOB_NOT_FOUND');
    if (!profile?.profile.confirmed) throw jobError('JOB_PROFILE_UNCONFIRMED');
    const model = settings?.settings.model || this.defaultModel;
    if (!model) throw jobError('JOB_MODEL_NOT_CONFIGURED');
    const previous = parentDraftId ? await this.draftRepository.get({ userId: scope.userId, draftId: parentDraftId }) : null;
    if (parentDraftId && (!previous?.current || previous.vacancy_id !== vacancyId)) throw jobError('JOB_REVISION_CONFLICT');
    const messages = buildJobPrompt({ vacancy: vacancy.snapshot, profile: profile.profile, instruction, language, previousText: previous?.text || '' });
    const task = await jobTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-generate:${scope.userId}:${vacancyId}`]);
      const existing = (await client.query('SELECT * FROM job_tasks WHERE user_id=$1 AND request_id=$2', [scope.userId, requestId])).rows[0];
      if (existing) return existing;
      const running = await client.query(`SELECT id FROM job_tasks WHERE user_id=$1 AND status='running'
        AND payload->>'vacancyId'=$2`, [scope.userId, vacancyId]);
      if (running.rowCount) throw jobError('JOB_GENERATION_BUSY');
      return (await client.query(`INSERT INTO job_tasks(user_id,request_id,kind,payload,status)
        VALUES($1,$2,'generate',$3,'running') RETURNING *`, [scope.userId, requestId, { vacancyId, parentDraftId }])).rows[0];
    });
    if (task.payload.vacancyId !== vacancyId || task.payload.parentDraftId !== parentDraftId) throw jobError('JOB_INVALID_REQUEST');
    if (task.status === 'complete') return this.draftRepository.get({ userId: scope.userId, draftId: task.result_id });
    // An existing running request never starts another billable model call.
    if (task.request_id !== requestId || task.payload.parentDraftId !== parentDraftId) throw jobError('JOB_INVALID_REQUEST');
    const claimed = await this.pool.query(`UPDATE job_tasks SET status='running',payload=payload||'{"invoked":true}'::jsonb
      WHERE id=$1 AND NOT (payload ? 'invoked') RETURNING id`, [task.id]);
    if (!claimed.rowCount) throw jobError(task.status === 'failed' ? 'JOB_GENERATION_FAILED' : 'JOB_GENERATION_BUSY');
    try {
      await this.usageRepository.record({ userId: scope.userId, requestId, outcome: 'pending', occurredAt: this.now() });
      const result = await this.modelAdapter.generate({ messages, model });
      await this.usageRepository.record({ userId: scope.userId, requestId, providerRequestId: result.requestId,
        costUsd: result.usage?.cost ?? null, outcome: 'success', occurredAt: this.now() });
      const letter = parseJobLetter(result.text, profile.profile);
      const draft = await this.draftRepository.append({ scope, vacancyId, parentDraftId, profileRevision: profile.revision,
        vacancyRevision: vacancy.revision, text: letter.text, facts: letter.factIds });
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
