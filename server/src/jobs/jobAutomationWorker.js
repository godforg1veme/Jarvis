const { trackWorker } = require('../lifecycle');
const { assertJobScope, jobError } = require('./jobSchemas');
const { evaluateVacancy } = require('./jobFilters');
const { assertAutomaticLetterTruth } = require('./jobPrompt');
const { enforceVacancyDirection } = require('./jobVacancyPrompt');

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
      if (this.repository.claimReconciliation) {
        const due = await this.repository.claimReconciliation();
        if (due) await this.reconcileDue(due);
      }
      const item = await this.repository.claimCandidate();
      if (item) await this.process(item);
    } finally { this.running = false; }
  }

  async reconcileDue(operation) {
    const scope = { userId: operation.user_id, conversationId: operation.origin_conversation_id,
      chatId: operation.origin_chat_id, channel: 'telegram' };
    try {
      // This method must never call process(), submitAutomatic() or generate().
      const result = await this.applicationService.reconcile({ scope, operationId: operation.operation_id });
      if (operation.item_id && ['sent','already_applied','manual_required','failed'].includes(result.applicationStatus)) {
        await this.repository.resolveUnknown({ itemId: operation.item_id, operationId: operation.operation_id,
          status: result.applicationStatus === 'already_applied' ? 'sent' : result.applicationStatus });
      }
    } catch {
      // Revocation, unavailable source and insufficient proof preserve unknown.
    } finally {
      const finished = await this.repository.finishReconciliation({ operationId: operation.operation_id,
        token: operation.reconciliation_token });
      if (finished?.status === 'unknown' && finished.reconciliation_attempts >= 6) {
        await this.repository.enqueueAttention({ scope, vacancyId: operation.vacancy_id,
          automationRevision: operation.automation_revision, code: 'RESULT_CHECK_EXHAUSTED' }).catch(() => {});
      }
    }
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
          if (status === 'manual_required' || (status === 'failed' && result.failureCode === 'JOB_AUTOMATION_PRECHECK_FAILED')) await this.repository.enqueueAttention({ scope,
            vacancyId: item.vacancy_id, automationRevision: item.automation_revision, code: 'MANUAL_REQUIRED',
            reasonCode: result.failureCode });
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
      const filterResult = evaluateVacancy({ vacancy: vacancy.snapshot, settings: settings.settings });
      if (!filterResult.include) {
        await this.repository.saveEvaluation({ itemId: item.id, evaluation: { decision: 'skip',
          directionMatched: false, reasonCode: 'USER_CONSTRAINT', rationale: 'Existing search filter excluded vacancy',
          source: 'filter', filterResult, revisions: { search: settings.revision,
            filter: vacancy.filter_revision, vacancy: vacancy.revision, automation: item.automation_revision } } });
        await this.repository.finalizeKnownSkip({ itemId: item.id, evaluatedSearchRevision: settings.revision }); return;
      }
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
          resumeContext, settings: settings.settings, filterResult,
          matchAnnotations: vacancy.annotations || [], requestId: item.evaluation_request_id, userId: scope.userId });
      } catch (error) {
        if (error?.modelUsage?.cost != null) await this.usageRepository.record({ userId: scope.userId,
          requestId: item.evaluation_request_id, providerRequestId: error.modelRequestId || null,
          costUsd: error.modelUsage.cost, costBasis: error.modelUsage.costBasis || 'provider', outcome: 'failed' });
        throw error;
      }
      await this.usageRepository.record({ userId: scope.userId, requestId: item.evaluation_request_id,
        providerRequestId: evaluation?.requestId || null, costUsd: evaluation?.usage?.cost ?? null,
        costBasis: evaluation?.usage?.costBasis || 'provider', outcome: 'success' });
      // Validate again at the worker boundary: an adapter cannot authorize a
      // letter using an ungrounded label or an incidental AI-tool mention.
      evaluation = enforceVacancyDirection({ decision: evaluation?.decision,
        directionMatched: evaluation?.directionMatched, reasonCode: evaluation?.reasonCode,
        rationale: evaluation?.rationale, directionAssessment: evaluation?.directionAssessment },
      { vacancy: vacancy.snapshot, settings: settings.settings });
      await this.repository.saveEvaluation({ itemId: item.id, evaluation: {
        decision: evaluation.decision, directionMatched: evaluation.directionMatched,
        reasonCode: evaluation.reasonCode, rationale: evaluation.rationale, source: 'model', filterResult,
        directionAssessment: evaluation.directionAssessment, selectionPolicyVersion: 2,
        revisions: { search: settings.revision, filter: vacancy.filter_revision,
          vacancy: vacancy.revision, profile: profile.revision,
          connection: resumeContext.connectionRevision, automation: item.automation_revision },
      } });
      if (evaluation.decision === 'skip') {
        await this.repository.finalizeKnownSkip({ itemId: item.id, evaluatedSearchRevision: settings.revision }); return;
      }
      if ((await this.searchRepository.getSettings({ userId: scope.userId }))?.revision !== settings.revision)
        throw jobError('JOB_REVISION_CONFLICT');
      await this.automationService.assertCurrent({ scope, revision: item.automation_revision,
        resumeId: resumeContext.resumeId, connectionRevision: resumeContext.connectionRevision });
      await this.repository.update({ itemId: item.id, from: phase, status: 'generating' });
      phase = 'generating';
      const draft = await this.draftService.generate({ scope, vacancyId: item.vacancy_id,
        requestId: item.draft_request_id, mode: 'improved', sourceText: profile.profile.baseLetter,
        expectedProfileRevision: profile.revision,
        expectedVacancyRevision: vacancy.revision, requireCompleteResume: true,
        automationRevision: item.automation_revision });
      assertAutomaticLetterTruth({ text: draft.text, resumeContext, profile: profile.profile });
      await this.automationService.assertCurrent({ scope, revision: item.automation_revision,
        resumeId: resumeContext.resumeId, connectionRevision: resumeContext.connectionRevision });
      await this.repository.update({ itemId: item.id, from: phase, status: 'submitting', draftId: draft.id });
      phase = 'submitting';
      const result = await this.applicationService.submitAutomatic({ scope, draftId: draft.id,
        automationRevision: item.automation_revision, expectedSearchRevision: settings.revision ?? null });
      const status = result.status === 'cancelled' ? 'skipped'
        : result.status === 'sent' || result.status === 'already_applied' ? 'sent'
        : result.status === 'manual_required' ? 'manual_required'
          : result.status === 'unknown' || result.status === 'sending' ? 'unknown' : 'failed';
      await this.repository.update({ itemId: item.id, from: phase, status, operationId: result.operationId,
        failurePhase: result.status === 'cancelled' ? 'preparation' : status === 'unknown' ? 'confirmation'
          : result.failureCode === 'JOB_HH_PREPARATION_FAILED' ? 'preparation' : null,
        failureCode: result.failureCode || null });
      if (status === 'manual_required' || (status === 'failed' && result.failureCode === 'JOB_AUTOMATION_PRECHECK_FAILED')) await this.repository.enqueueAttention({ scope,
        vacancyId: item.vacancy_id, automationRevision: item.automation_revision, code: 'MANUAL_REQUIRED',
        reasonCode: result.failureCode });
      else if (status === 'unknown') await this.repository.enqueueAttention({ scope,
        vacancyId: item.vacancy_id, automationRevision: item.automation_revision, code: 'RESULT_UNKNOWN' });
    } catch (error) {
      const failurePhase = phase === 'evaluating' ? 'evaluation' : phase === 'generating' ? 'generation' : 'submission';
      if (phase !== 'submitting' && ['JOB_AUTOMATION_UNAVAILABLE','JOB_REVISION_CONFLICT'].includes(error?.code)) {
        await this.repository.update({ itemId: item.id, from: phase, status: 'skipped',
          failurePhase, failureCode: error.code });
        return;
      }
      const invalidLetter = phase === 'generating' && error?.code === 'JOB_LETTER_VALIDATION_FAILED';
      const invalidEvaluation = phase === 'evaluating'
        && ['JOB_MODEL_INVALID_OUTPUT','JOB_MODEL_INVALID_FACTS'].includes(error?.code);
      if (invalidLetter || invalidEvaluation) {
        const reason = invalidLetter ? 'JOB_LETTER_VALIDATION_FAILED' : 'JOB_MODEL_EVALUATION_INVALID';
        await this.repository.update({ itemId: item.id, from: phase, status: 'manual_required',
          failurePhase, failureCode: reason });
        await this.repository.enqueueAttention({ scope, vacancyId: item.vacancy_id,
          automationRevision: item.automation_revision, code: 'MANUAL_REQUIRED', reasonCode: reason }).catch(() => {});
        return;
      }
      if (['JOB_APPLICANT_ANSWER_REQUIRED', 'JOB_LETTER_UNSUPPORTED_INTENT'].includes(error?.code)
        && phase === 'generating') {
        await this.repository.update({ itemId: item.id, from: phase, status: 'manual_required' });
        try { await this.repository.enqueueAttention({ scope, vacancyId: item.vacancy_id,
          automationRevision: item.automation_revision, code: 'MANUAL_REQUIRED', reasonCode: error.code }); } catch {}
        return;
      }
      const code = ['JOB_HH_LOGIN_REQUIRED','JOB_HH_NOT_CONNECTED'].includes(error?.code) ? 'LOGIN_REQUIRED'
        : ['JOB_HH_RESUME_UNAVAILABLE','JOB_DRAFT_RESUME_STALE'].includes(error?.code) ? 'RESUME_UNAVAILABLE'
          : ['JOB_MODEL_UNAVAILABLE','JOB_MODEL_NOT_CONFIGURED','JOB_MODEL_INVALID_OUTPUT','JOB_MODEL_INVALID_FACTS',
            'JOB_GENERATION_OUTCOME_UNKNOWN','JOB_GENERATION_BUSY'].includes(error?.code)
            ? 'MODEL_UNAVAILABLE' : null;
      // A pending HH challenge blocks the selected resume read before any model
      // request or application claim. Keep that exact item retryable after the
      // challenge is resolved, and pause this user's automation to avoid a burst.
      const captchaWaiting = phase === 'evaluating' && !modelInvoked
        && ['JOB_HH_MANUAL_ACTIVE','JOB_HH_CAPTCHA_MANUAL_REQUIRED',
          'JOB_HH_CAPTCHA_REQUIRED','JOB_HH_CAPTCHA_WAITING'].includes(error?.code);
      // The selected resume is read-only at this point. A temporary source,
      // login or browser failure can be retried under the same item after a
      // pause; once a model call began, its original request ID stays unknown.
      const sourceWaiting = phase === 'evaluating' && !modelInvoked
        && ['JOB_HH_UNAVAILABLE','JOB_HH_RATE_LIMIT','JOB_BROWSER_BUSY',
          'JOB_HH_LOGIN_REQUIRED','JOB_HH_NOT_CONNECTED'].includes(error?.code);
      const pending = phase === 'evaluating' && !modelInvoked
        && (code === 'RESUME_UNAVAILABLE' || captchaWaiting || sourceWaiting);
      const unknown = !(phase === 'evaluating' && !modelInvoked);
      await this.repository.update({ itemId: item.id, from: phase,
        status: pending ? 'pending' : unknown ? 'unknown' : 'failed', failurePhase,
        failureCode: /^JOB_[A-Z_]{1,70}$/.test(error?.code || '') ? error.code : 'JOB_PROCESSING_FAILED' });
      if (captchaWaiting || sourceWaiting) {
        await this.repository.backoff({ scope, automationRevision: item.automation_revision });
        if (code !== 'LOGIN_REQUIRED') return;
      }
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
