const { assertJobScope, jobError } = require('./jobSchemas');
const { response, button } = require('./jobTelegramViews');
const { normalizeQuestionnaire, normalizeAnswers } = require('../../../shared/jobQuestionnaire');
const { normalizeStopReason, manualStopMessage } = require('./jobStopReasons');

function applicationView(operation) {
  const text = { sending: 'Отправка обрабатывается. Повторный отклик не запущен.',
    sent: 'Отклик отправлен. Источник подтвердил результат.',
    unknown: 'Результат отправки пока неизвестен. Повторный отклик заблокирован до проверки исходной операции.',
    failed: 'Источник отклонил отправку. Успешный отклик не подтверждён.',
    already_applied: 'В источнике уже есть отклик на эту вакансию. Повторный не отправлен.',
    manual_required: manualStopMessage(operation.failure_code) }[operation.status];
  if (!text) throw jobError('JOB_INVALID_APPLICATION_STATUS');
  const buttons = [];
  if (['sending', 'unknown'].includes(operation.status)) buttons.push([button('Проверить результат', 'confirm', operation.confirmation_id)]);
  buttons.push([button('В поиск работы', 'menu')]);
  return { ...response(text, buttons), applicationStatus: operation.status, operationId: operation.operation_id,
    failureCode: operation.failure_code || null };
}

class JobApplicationService {
  constructor({ pool, repository, searchRepository, adapter = null, historyRepository = null, accessService = null, automationRepository = null, questionAnswerService = null }) {
    Object.assign(this, { pool, repository, searchRepository, adapter, historyRepository, accessService, automationRepository, questionAnswerService });
  }
  async requireAdapter({ scope }) {
    await assertJobScope(this.pool, scope, this.accessService);
    if (!this.adapter || this.adapter.capabilities?.applicantApply !== true) throw jobError('JOB_APPLICANT_API_UNAVAILABLE');
  }
  async inspect({ scope, draftId, allowQuestions = false }) {
    const row = (await this.pool.query(`SELECT d.*,v.external_id FROM job_drafts d
      JOIN job_vacancies v ON v.id=d.vacancy_id WHERE d.id=$1 AND d.user_id=$2 AND d.current`, [draftId, scope.userId])).rows[0];
    if (!row) throw jobError('JOB_NOT_FOUND');
    const connection = (await this.pool.query(`SELECT resume_id,status,revision FROM job_connections WHERE user_id=$1`, [scope.userId])).rows[0];
    if (!connection?.resume_id || connection.status !== 'connected') throw jobError('JOB_HH_NOT_CONNECTED');
    let inspected;
    try { inspected = await this.adapter.inspect({ userId: scope.userId, externalId: row.external_id, resumeId: connection.resume_id }); }
    catch (error) {
      if (['JOB_HH_CAPTCHA_REQUIRED','JOB_HH_CAPTCHA_MANUAL_REQUIRED','JOB_HH_CAPTCHA_WAITING'].includes(error?.code))
        return { outcome: 'manual_required', failureCode: 'JOB_HH_CAPTCHA_REQUIRED' };
      throw error;
    }
    if (inspected.resumeAvailable !== true) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
    if (!inspected.vacancy || inspected.vacancy.externalId !== row.external_id || inspected.vacancy.archived) throw jobError('JOB_HH_NOT_FOUND');
    const latest = await this.searchRepository.upsertVacancy({ externalId: row.external_id, snapshot: inspected.vacancy });
    if (latest.revision !== row.vacancy_revision) throw jobError('JOB_REVISION_CONFLICT');
    if(inspected.existingApplication){
      if(inspected.existingApplication.vacancyId!==row.external_id||inspected.existingApplication.resumeHash!==connection.resume_id
        ||inspected.existingApplication.topicId!==inspected.existingApplicationId)throw jobError('JOB_HH_INVALID_RESPONSE');
      if(this.historyRepository)await this.historyRepository.observe({scope,item:inspected.existingApplication});
    }
    if (inspected.existingApplicationId || inspected.reasonCode==='JOB_HH_ALREADY_APPLIED') return { outcome: 'already_applied', externalId: inspected.existingApplicationId };
    if (inspected.questionnaire && inspected.reasonCode === 'JOB_HH_QUESTIONS_REQUIRED') {
      const questionnaire = normalizeQuestionnaire(inspected.questionnaire);
      if (allowQuestions) return { outcome: 'questions_required', questionnaire };
    }
    if (inspected.manualRequired || inspected.vacancy.manualRequired || inspected.questionnaire)
      return { outcome: 'manual_required', failureCode: normalizeStopReason(inspected.reasonCode) };
    return null;
  }
  async prepareConfirmation({ scope, draftId }) {
    await this.requireAdapter({ scope });
    const blocked = await this.inspect({ scope, draftId });
    if (blocked) return response(blocked.outcome === 'already_applied' ? 'На эту вакансию уже есть отклик. Повторный не отправлен.' : manualStopMessage(blocked.failureCode),
      blocked.outcome==='already_applied'?[[button('Отклики','applications',0)]]:[]);
    const c = await this.repository.prepare({ scope, draftId });
    return response(`Проверь отклик перед отправкой\n${c.frozen.title}\n${c.frozen.company}
Резюме: ${c.frozen.resumeId}\n${c.frozen.url}\n\n${c.frozen.text}\n\nПодтвердить отправку именно этого текста?`,
    [[button('Подтвердить отправку', 'confirm', c.id)], [button('Назад к письму', 'draft', draftId)]]);
  }
  async confirm({ scope, confirmationId }) {
    await this.requireAdapter({ scope });
    const confirmation = await this.repository.getConfirmation({ scope, confirmationId });
    if (!confirmation) throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
    if (confirmation.status === 'consumed') {
      const replay = await this.repository.claim({ scope, confirmationId });
      if (replay.operation.status === 'unknown') return this.reconcile({ scope, operationId: replay.operation.operation_id });
      return applicationView(replay.operation);
    }
    // Inspection is read-only. The atomic claim below rechecks all local versions.
    const blocked = await this.inspect({ scope, draftId: confirmation.target_id });
    if (blocked) return response(blocked.outcome === 'already_applied' ? 'На эту вакансию уже есть отклик. Повторный не отправлен.' : manualStopMessage(blocked.failureCode),
      blocked.outcome==='already_applied'?[[button('Отклики','applications',0)]]:[]);
    const { operation, execute } = await this.repository.claim({ scope, confirmationId });
    if (!execute) return applicationView(operation);
    let result;
    try {
      result = await this.adapter.submit({ userId: scope.userId, operationId: operation.operation_id,
        externalId: confirmation.frozen.externalId, resumeId: operation.resume_id, letter: operation.approved_text });
    } catch { result = { outcome: 'unknown', failureCode: 'JOB_SUBMISSION_OUTCOME_UNKNOWN' }; }
    const valid = this.validResult(result);
    const saved = await this.repository.finish({ userId: scope.userId, operationId: operation.operation_id, ...valid });
    return applicationView(saved || operation);
  }
  async submitAutomatic({ scope, draftId, automationRevision, expectedSearchRevision = null }) {
    await this.requireAdapter({ scope });
    if (!this.automationRepository) throw jobError('JOB_AUTOMATION_UNAVAILABLE');
    await this.automationRepository.assertCurrent({ scope, revision: automationRevision });
    const previous = await this.repository.findAutomaticForDraft?.({ scope, draftId });
    if (previous) return { status: ['sending','unknown'].includes(previous.status) ? 'unknown' : previous.status,
      operationId: previous.operation_id, failureCode: previous.failure_code || null };
    const blocked = await this.inspect({ scope, draftId, allowQuestions: true });
    let preparedAnswers = null;
    if (blocked?.outcome === 'questions_required') {
      if (!this.questionAnswerService) return { status: 'manual_required', operationId: null, failureCode: 'JOB_HH_QUESTIONS_REQUIRED' };
      preparedAnswers = await this.questionAnswerService.prepare({ scope, draftId, automationRevision, questionnaire: blocked.questionnaire });
      if (preparedAnswers.status !== 'ready') return { status: 'manual_required', operationId: null,
        failureCode: normalizeStopReason(preparedAnswers.failureCode) };
      const current = await this.inspect({ scope, draftId, allowQuestions: true });
      if (current?.outcome !== 'questions_required' || current.questionnaire.hash !== preparedAnswers.questionnaire.hash)
        return { status: 'manual_required', operationId: null, failureCode: 'JOB_HH_FORM_CHANGED' };
      await this.questionAnswerService.assertCurrent({ scope, draftId, automationRevision, versions: preparedAnswers.versions });
    } else if (blocked) return { status: blocked.outcome, operationId: null, failureCode: blocked.failureCode || null };
    const { operation, execute } = await this.repository.claimAutomatic({ scope, draftId, automationRevision,
      expectedSearchRevision,
      ...(preparedAnswers ? { questionnaire: preparedAnswers.questionnaire, answers: preparedAnswers.answers,
        questionnaireContext: preparedAnswers.versions } : {}) });
    if (!execute) {
      if (operation.status === 'unknown' || operation.status === 'sending')
        return { status: 'unknown', operationId: operation.operation_id };
      return { status: operation.status, operationId: operation.operation_id, failureCode: operation.failure_code || null };
    }
    try {
      await this.automationRepository.assertCurrent({ scope, revision: automationRevision,
        resumeId: operation.resume_id });
      const latest = (await this.pool.query(`SELECT m.hidden,m.filter_revision,s.revision AS search_revision
        FROM job_matches m JOIN job_searches s ON s.user_id=m.user_id
        WHERE m.user_id=$1 AND m.vacancy_id=$2`, [scope.userId, operation.vacancy_id])).rows[0];
      if (!latest || latest.hidden || latest.filter_revision !== latest.search_revision)
        throw jobError('JOB_REVISION_CONFLICT');
      if (expectedSearchRevision !== null && latest.search_revision !== expectedSearchRevision) throw jobError('JOB_REVISION_CONFLICT');
      if (operation.questionnaire_context) await this.questionAnswerService.assertCurrent({ scope, draftId,
        automationRevision, versions: operation.questionnaire_context });
    } catch {
      await this.repository.finish({ userId: scope.userId, operationId: operation.operation_id,
        status: 'failed', failureCode: 'JOB_AUTOMATION_PRECHECK_FAILED' });
      return { status: 'failed', operationId: operation.operation_id, failureCode: 'JOB_AUTOMATION_PRECHECK_FAILED' };
    }
    let result;
    try {
      result = await this.adapter.submit({ userId: scope.userId, operationId: operation.operation_id,
        externalId: (await this.repository.get({ scope, operationId: operation.operation_id })).vacancy_external_id,
        resumeId: operation.resume_id, letter: operation.approved_text, ...this.questionPayload(operation) });
    } catch { result = { outcome: 'unknown', failureCode: 'JOB_SUBMISSION_OUTCOME_UNKNOWN' }; }
    const saved = await this.repository.finish({ userId: scope.userId, operationId: operation.operation_id,
      ...this.validResult(result) });
    return { status: (saved || operation).status, operationId: operation.operation_id,
      failureCode: (saved || operation).failure_code || null };
  }
  questionPayload(operation) {
    if (!operation.questionnaire) return {};
    const questionnaire = normalizeQuestionnaire(operation.questionnaire);
    return { questionnaire, answers: normalizeAnswers(questionnaire, operation.questionnaire_answers) };
  }
  validResult(result) {
    if (result?.outcome === 'sent' && result.verified === true && /^[\w-]{1,128}$/.test(String(result.externalId || ''))) {
      return { status: 'sent', externalId: String(result.externalId) };
    }
    if (['failed', 'manual_required', 'already_applied'].includes(result?.outcome) && result.verified === true) {
      return { status: result.outcome,
        ...(result.outcome === 'manual_required' ? { failureCode: normalizeStopReason(result.reasonCode || result.failureCode) } : {}) };
    }
    return { status: 'unknown', failureCode: 'JOB_SUBMISSION_OUTCOME_UNKNOWN' };
  }
  async reconcile({ scope, operationId }) {
    await this.requireAdapter({ scope });
    const operation = await this.repository.get({ scope, operationId });
    if (!operation) throw jobError('JOB_NOT_FOUND');
    if (!['unknown', 'sending'].includes(operation.status)) return applicationView(operation);
    let result;
    try { result = await this.adapter.reconcile({ userId: scope.userId, operationId,
      externalId: operation.vacancy_external_id, resumeId: operation.resume_id, letter: operation.approved_text,
      ...this.questionPayload(operation) }); }
    catch { return applicationView({ ...operation, status: 'unknown' }); }
    const saved = await this.repository.finish({ userId: scope.userId, operationId, ...this.validResult(result) });
    return applicationView(saved || operation);
  }
}
module.exports = { JobApplicationService, applicationView };
