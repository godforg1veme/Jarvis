const { assertJobScope, jobError } = require('./jobSchemas');
const { response, button } = require('./jobTelegramViews');

function applicationView(operation) {
  const text = { sending: 'Отправка обрабатывается. Повторный отклик не запущен.',
    sent: 'Отклик отправлен. Источник подтвердил результат.',
    unknown: 'Результат отправки пока неизвестен. Повторный отклик заблокирован до проверки исходной операции.',
    failed: 'Источник отклонил отправку. Успешный отклик не подтверждён.',
    already_applied: 'В источнике уже есть отклик на эту вакансию. Повторный не отправлен.',
    manual_required: 'В источнике нужны дополнительные действия. Автоматический отклик не отправлен.' }[operation.status];
  if (!text) throw jobError('JOB_INVALID_APPLICATION_STATUS');
  const buttons = [];
  if (['sending', 'unknown'].includes(operation.status)) buttons.push([button('Проверить результат', 'confirm', operation.confirmation_id)]);
  buttons.push([button('В поиск работы', 'menu')]);
  return { ...response(text, buttons), applicationStatus: operation.status, operationId: operation.operation_id };
}

class JobApplicationService {
  constructor({ pool, repository, searchRepository, adapter = null }) {
    Object.assign(this, { pool, repository, searchRepository, adapter });
  }
  async requireAdapter({ scope }) {
    await assertJobScope(this.pool, scope);
    if (!this.adapter || this.adapter.capabilities?.applicantApply !== true) throw jobError('JOB_APPLICANT_API_UNAVAILABLE');
  }
  async inspect({ scope, draftId }) {
    const row = (await this.pool.query(`SELECT d.*,v.external_id FROM job_drafts d
      JOIN job_vacancies v ON v.id=d.vacancy_id WHERE d.id=$1 AND d.user_id=$2 AND d.current`, [draftId, scope.userId])).rows[0];
    if (!row) throw jobError('JOB_NOT_FOUND');
    const connection = (await this.pool.query(`SELECT resume_id,status,revision FROM job_connections WHERE user_id=$1`, [scope.userId])).rows[0];
    if (!connection?.resume_id || connection.status !== 'connected') throw jobError('JOB_HH_NOT_CONNECTED');
    const inspected = await this.adapter.inspect({ userId: scope.userId, externalId: row.external_id, resumeId: connection.resume_id });
    if (inspected.resumeAvailable !== true) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
    if (!inspected.vacancy || inspected.vacancy.externalId !== row.external_id || inspected.vacancy.archived) throw jobError('JOB_HH_NOT_FOUND');
    const latest = await this.searchRepository.upsertVacancy({ externalId: row.external_id, snapshot: inspected.vacancy });
    if (latest.revision !== row.vacancy_revision) throw jobError('JOB_REVISION_CONFLICT');
    if (inspected.existingApplicationId) return { outcome: 'already_applied', externalId: inspected.existingApplicationId };
    if (inspected.manualRequired || inspected.vacancy.manualRequired) return { outcome: 'manual_required' };
    return null;
  }
  async prepareConfirmation({ scope, draftId }) {
    await this.requireAdapter({ scope });
    const blocked = await this.inspect({ scope, draftId });
    if (blocked) return response(blocked.outcome === 'already_applied' ? 'В источнике уже есть отклик. Повторный не отправлен.' : 'Для этой вакансии нужны дополнительные действия в источнике. Письмо не отправлено.');
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
    if (blocked) return response(blocked.outcome === 'already_applied' ? 'В источнике уже есть отклик. Повторный не отправлен.' : 'В источнике нужны дополнительные действия. Отклик не отправлен.');
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
  validResult(result) {
    if (result?.outcome === 'sent' && result.verified === true && /^[\w-]{1,128}$/.test(String(result.externalId || ''))) {
      return { status: 'sent', externalId: String(result.externalId) };
    }
    if (['failed', 'manual_required', 'already_applied'].includes(result?.outcome) && result.verified === true) {
      return { status: result.outcome };
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
      externalId: operation.vacancy_external_id, resumeId: operation.resume_id }); }
    catch { return applicationView({ ...operation, status: 'unknown' }); }
    const saved = await this.repository.finish({ userId: scope.userId, operationId, ...this.validResult(result) });
    return applicationView(saved || operation);
  }
}
module.exports = { JobApplicationService, applicationView };
