const { assertJobScope, jobError } = require('./jobSchemas');

class JobAutomationService {
  constructor({ pool, repository, searchRepository, resumeContextService, accessService = null, available = false }) {
    Object.assign(this, { pool, repository, searchRepository, resumeContextService, accessService, available });
  }
  async get({ scope }) {
    await assertJobScope(this.pool, scope, this.accessService);
    const row = await this.repository.get({ scope });
    const search = await this.searchRepository.getSettings({ userId: scope.userId });
    const connection = await this.resumeContextService.selected(scope, { allowDisconnected: true });
    const usable = this.available && Boolean(connection && search?.settings?.activated && !search.settings.paused);
    const validConsent = Boolean(row?.enabled && connection && row.resume_id === connection.resume_id
      && row.connection_revision === connection.revision
      && row.conversation_id === scope.conversationId && row.chat_id === scope.chatId
      && search.conversation_id === scope.conversationId && search.chat_id === scope.chatId);
    return { enabled: Boolean(row?.enabled), revision: row?.revision || 0,
      available: usable && (!row?.enabled || validConsent),
      reason: usable && (!row?.enabled || validConsent) ? null : 'JOB_AUTOMATION_UNAVAILABLE' };
  }
  async setEnabled({ scope, enabled, expectedRevision }) {
    if (typeof enabled !== 'boolean') throw jobError('JOB_INVALID_SETTINGS_INPUT');
    await assertJobScope(this.pool, scope, this.accessService);
    if (enabled && !this.available) throw jobError('JOB_AUTOMATION_UNAVAILABLE');
    const selected = enabled ? await this.resumeContextService.selected(scope) : null;
    await this.repository.setEnabled({ scope, enabled, expectedRevision,
      resumeId: selected?.resume_id || null, connectionRevision: selected?.revision || null });
    return this.get({ scope });
  }
  async assertCurrent({ scope, revision, resumeId = null, connectionRevision = null }) {
    if (!this.available) throw jobError('JOB_AUTOMATION_UNAVAILABLE');
    return this.repository.assertCurrent({ scope, revision, resumeId, connectionRevision });
  }
}

module.exports = { JobAutomationService };
