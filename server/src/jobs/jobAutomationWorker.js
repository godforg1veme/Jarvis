const { trackWorker } = require('../lifecycle');
const { assertJobScope, jobError } = require('./jobSchemas');

class JobAutomationWorker {
  constructor({ pool, repository, automationService, searchRepository, profileRepository,
    resumeContextService, modelAdapter, draftService, applicationService, usageRepository,
    accessService = null, intervalMs = 2000 }) {
    Object.assign(this, { pool, repository, automationService, searchRepository, profileRepository,
      resumeContextService, modelAdapter, draftService, applicationService, usageRepository,
      accessService, intervalMs });
    this.timer = null; this.running = false;
    trackWorker(this, 'tick');
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const missing = await this.repository.claimPrerequisites();
      for (const row of missing) {
        const scope = { userId: row.user_id, conversationId: row.conversation_id,
          chatId: row.chat_id, channel: 'telegram' };
        try { await this.repository.enqueueAttention({ scope, vacancyId: null,
          automationRevision: row.revision, code: row.code }); } catch {}
      }
      const interrupted = await this.repository.recoverInterrupted();
      for (const item of interrupted) await this.recover(item);
      const item = await this.repository.claimCandidate();
      if (item) await this.process(item);
    } finally { this.running = false; }
  }

  async recover(item) {
    const scope = { userId: item.user_id, conversationId: item.conversation_id,
      chatId: item.chat_id, channel: 'telegram' };
    try {
      await this.automationService.assertCurrent({ scope, revision: item.automation_revision });
      const operationId = item.operation_id || item.known_operation_id;
      if (operationId) {
        const result = await this.applicationService.reconcile({ scope, operationId });
        const status = result.applicationStatus;
        if (status === 'sent' || status === 'already_applied' || status === 'manual_required' || status === 'failed') {
          await this.repository.resolveUnknown({ itemId: item.id, operationId,
            status: status === 'already_applied' ? 'sent' : status });
          if (status === 'manual_required') await this.repository.enqueueAttention({ scope,
            vacancyId: item.vacancy_id, automationRevision: item.automation_revision, code: 'MANUAL_REQUIRED' });
          return;
        }
      }
      await this.repository.enqueueAttention({ scope, vacancyId: item.vacancy_id,
        automationRevision: item.automation_revision, code: operationId ? 'RESULT_UNKNOWN' : 'PROCESSING_UNKNOWN' });
    } catch {
      // The original operation remains unknown; a later authenticated status
      // inspection can use its persisted ID without creating a second request.
    }
  }

  async process(item) {
    const scope = { userId: item.user_id, conversationId: item.conversation_id,
      chatId: item.chat_id, channel: 'telegram' };
    let phase = 'evaluating';
    let modelInvoked = false;
    let settings;
    try {
      await assertJobScope(this.pool, scope, this.accessService);
      await this.automationService.assertCurrent({ scope, revision: item.automation_revision });
      settings = await this.searchRepository.getSettings({ userId: scope.userId });
      const vacancy = await this.searchRepository.getVacancy({ userId: scope.userId, vacancyId: item.vacancy_id });
      if (!vacancy || vacancy.hidden || vacancy.snapshot?.archived) {
        await this.repository.update({ itemId: item.id, from: phase, status: 'skipped' }); return;
      }
      const previous = (await this.pool.query('SELECT id FROM job_applications WHERE user_id=$1 AND vacancy_id=$2 LIMIT 1',
        [scope.userId, item.vacancy_id])).rows[0];
      if (previous) { await this.repository.update({ itemId: item.id, from: phase, status: 'skipped' }); return; }
      const profile = await this.profileRepository.ensure({ scope });
      const resumeContext = await this.resumeContextService.getSelected({ scope, requireComplete: true });
      if (!resumeContext) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
      await this.automationService.assertCurrent({ scope, revision: item.automation_revision,
        resumeId: resumeContext.resumeId, connectionRevision: resumeContext.connectionRevision });
      // Persist the request ID before an API call. An interrupted call cannot
      // safely be issued again under a new ID merely to obtain a result.
      await this.usageRepository.record({ userId: scope.userId, requestId: item.evaluation_request_id, outcome: 'pending' });
      let evaluation;
      try {
        modelInvoked = true;
        evaluation = await this.modelAdapter.evaluate({ vacancy: vacancy.snapshot, profile: profile.profile,
          resumeContext, settings: settings.settings, requestId: item.evaluation_request_id, userId: scope.userId });
      } catch (error) {
        if (error?.modelUsage?.cost != null) await this.usageRepository.record({ userId: scope.userId,
          requestId: item.evaluation_request_id, providerRequestId: error.modelRequestId || null,
          costUsd: error.modelUsage.cost, costBasis: error.modelUsage.costBasis || 'provider', outcome: 'failed' });
        throw error;
      }
      await this.usageRepository.record({ userId: scope.userId, requestId: item.evaluation_request_id,
        providerRequestId: evaluation?.requestId || null, costUsd: evaluation?.usage?.cost ?? null,
        costBasis: evaluation?.usage?.costBasis || 'provider', outcome: 'success' });
      if (!evaluation || !['apply','skip'].includes(evaluation.decision)) throw jobError('JOB_MODEL_INVALID_OUTPUT');
      if (evaluation.decision === 'skip') {
        await this.repository.update({ itemId: item.id, from: phase, status: 'skipped' }); return;
      }
      await this.automationService.assertCurrent({ scope, revision: item.automation_revision,
        resumeId: resumeContext.resumeId, connectionRevision: resumeContext.connectionRevision });
      await this.repository.update({ itemId: item.id, from: phase, status: 'generating' });
      phase = 'generating';
      const draft = await this.draftService.generate({ scope, vacancyId: item.vacancy_id,
        requestId: item.draft_request_id, mode: 'improved', expectedProfileRevision: profile.revision,
        expectedVacancyRevision: vacancy.revision, requireCompleteResume: true });
      await this.automationService.assertCurrent({ scope, revision: item.automation_revision,
        resumeId: resumeContext.resumeId, connectionRevision: resumeContext.connectionRevision });
      await this.repository.update({ itemId: item.id, from: phase, status: 'submitting', draftId: draft.id });
      phase = 'submitting';
      const result = await this.applicationService.submitAutomatic({ scope, draftId: draft.id,
        automationRevision: item.automation_revision });
      const status = result.status === 'sent' || result.status === 'already_applied' ? 'sent'
        : result.status === 'manual_required' ? 'manual_required'
          : result.status === 'unknown' || result.status === 'sending' ? 'unknown' : 'failed';
      await this.repository.update({ itemId: item.id, from: phase, status, operationId: result.operationId });
      if (status === 'manual_required') await this.repository.enqueueAttention({ scope,
        vacancyId: item.vacancy_id, automationRevision: item.automation_revision, code: 'MANUAL_REQUIRED' });
      else if (status === 'unknown') await this.repository.enqueueAttention({ scope,
        vacancyId: item.vacancy_id, automationRevision: item.automation_revision, code: 'RESULT_UNKNOWN' });
    } catch (error) {
      const code = ['JOB_HH_LOGIN_REQUIRED','JOB_HH_NOT_CONNECTED'].includes(error?.code) ? 'LOGIN_REQUIRED'
        : ['JOB_HH_RESUME_UNAVAILABLE','JOB_DRAFT_RESUME_STALE'].includes(error?.code) ? 'RESUME_UNAVAILABLE'
          : ['JOB_MODEL_UNAVAILABLE','JOB_MODEL_NOT_CONFIGURED','JOB_MODEL_INVALID_OUTPUT','JOB_MODEL_INVALID_FACTS'].includes(error?.code)
            ? 'MODEL_UNAVAILABLE' : null;
      const pending = phase === 'evaluating' && !modelInvoked && code === 'RESUME_UNAVAILABLE';
      const unknown = !(phase === 'evaluating' && !modelInvoked);
      await this.repository.update({ itemId: item.id, from: phase,
        status: pending ? 'pending' : unknown ? 'unknown' : 'failed' });
      if (code) {
        try {
          if (code === 'MODEL_UNAVAILABLE' || code === 'RESUME_UNAVAILABLE')
            await this.repository.backoff({ scope, automationRevision: item.automation_revision });
          await this.repository.enqueueAttention({ scope, vacancyId: item.vacancy_id,
            automationRevision: item.automation_revision, code });
        } catch {}
      } else if (unknown) {
        try { await this.repository.enqueueAttention({ scope, vacancyId: item.vacancy_id,
          automationRevision: item.automation_revision, code: 'PROCESSING_UNKNOWN' }); } catch {}
      }
    } finally {
      if (settings) await this.usageRepository.claimBudgetNotice({ userId: scope.userId,
        thresholdUsd: settings.settings.budgetUsd }).catch(() => {});
    }
  }
  start() {
    if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(() => {}); }, this.intervalMs); this.timer.unref?.(); }
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  close() { this.stop(); }
}

module.exports = { JobAutomationWorker };
