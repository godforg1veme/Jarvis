const UUID_PATTERN = /^[a-f0-9-]{36}$/i;
const LIFE_MODES = new Set(['work', 'focus', 'home', 'family', 'meeting', 'travel', 'rest', 'sleep', 'emergency']);
const MISSION_ACTIONS = new Set(['pin', 'replace', 'hide', 'restore']);
const REMINDER_ACTIONS = new Set(['cancel', 'acknowledge']);
const SOURCE_TYPES = new Set(['calendar', 'email', 'tasks', 'receipts', 'deliveries', 'travel', 'subscriptions', 'smart_home']);
const RELATIONSHIP_TYPES = new Set(['family', 'partner', 'friend', 'colleague', 'client', 'provider', 'other']);
const PREFERENCE_KEYS = new Set(['response.style', 'contextual_adaptation.enabled', 'initiative.level', 'notifications.quiet_hours',
  'notifications.max_proactive_per_day', 'areas.priorities', 'proposal.suppressed_rules', 'links.low_confidence_behavior', 'reminders.default_lead_minutes']);

function closed(value, allowed) {
  if (!allowed.has(value)) { const error = new Error('invalid closed value'); error.code = 'LIFE_INVALID_INPUT'; throw error; }
  return value;
}

function lifeId(value) {
  return UUID_PATTERN.test(String(value || '')) ? String(value) : '';
}

function revision(value, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 0;
}

function boundedText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function boundedObject(value, maxBytes = 4096) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) return {};
    const parsed = JSON.parse(serialized);
    return parsed && Object.getPrototypeOf(parsed) === Object.prototype ? parsed : {};
  } catch (_) {
    return {};
  }
}

function registerLifeOsIpc({ ipcMain, isTrustedRenderer, getClient }) {
  const call = async (event, action) => {
    const client = getClient();
    if (!isTrustedRenderer(event) || !client) return { ok: false, code: 'LIFE_ACCESS_DENIED', error: 'Access denied.' };
    try {
      return await action(client);
    } catch (error) {
      const code = error && error.code;
      if (code === 'LIFE_REVISION_CONFLICT' || code === 'LIFE_RECOVERY_CONTEXT_CONFLICT') {
        return { ok: false, code, error: 'Данные уже изменились. Обновите экран.' };
      }
      return { ok: false, code, error: 'Life OS сейчас недоступен.' };
    }
  };
  const handle = (channel, handler) => ipcMain.handle(channel, (event, input = {}) => call(event, (client) => handler(client, input || {})));

  handle('life:bootstrap', (client) => client.getLifeBootstrap());
  handle('life:mission-control', (client) => client.getMissionControl());
  handle('life:timeline', (client, input) => client.getLifeTimeline({
    projectId: lifeId(input.projectId), cursor: String(input.cursor || '').slice(0, 512), limit: input.limit,
  }));
  handle('life:project-create', (client, input) => client.createLifeProject({
    name: boundedText(input.name, 160), summary: boundedText(input.summary, 2000),
    ...(lifeId(input.areaId) ? { areaId: lifeId(input.areaId) } : {}),
  }));
  handle('life:project-update', (client, payload) => {
    const input = payload.input || {};
    const patch = { revision: revision(input.revision) };
    if (typeof input.name === 'string') patch.name = boundedText(input.name, 160);
    if (typeof input.summary === 'string') patch.summary = boundedText(input.summary, 2000);
    if (['active', 'paused', 'completed', 'archived'].includes(input.status)) patch.status = input.status;
    if (input.areaId === null || lifeId(input.areaId)) patch.areaId = input.areaId === null ? null : lifeId(input.areaId);
    if (input.targetAt === null || (typeof input.targetAt === 'string' && input.targetAt.length <= 40)) patch.targetAt = input.targetAt;
    return client.updateLifeProject(lifeId(payload.projectId), patch);
  });
  handle('life:project-context', (client, input) => client.getLifeProjectContext(lifeId(input.projectId)));
  handle('life:feedback', (client, input) => client.recordLifeFeedback(lifeId(input.eventId), {
    kind: boundedText(input.kind, 40), note: boundedText(input.note, 500),
  }));
  handle('life:proposal-confirm', (client, input) => client.confirmLifeProposal(lifeId(input.proposalId), revision(input.revision)));
  handle('life:proposal-dismiss', (client, input) => client.dismissLifeProposal(lifeId(input.proposalId), revision(input.revision)));
  handle('life:commitment-update', (client, input) => client.updateLifeCommitment(
    lifeId(input.commitmentId), revision(input.revision), input.status === 'dismissed' ? 'dismissed' : 'completed',
  ));

  handle('life:reminders', (client, input) => client.getLifeReminders(['scheduled', 'delivered', 'failed', 'outcome_unknown'].includes(input.state) ? input.state : ''));
  handle('life:reminder-reschedule', (client, input) => client.rescheduleLifeReminder(lifeId(input.reminderId), {
    revision: revision(input.revision), triggerAt: String(input.triggerAt || '').slice(0, 40),
    ...(typeof input.timezone === 'string' ? { timezone: boundedText(input.timezone, 80) } : {}),
  }));
  handle('life:reminder-action', (client, input) => client.mutateLifeReminder(
    lifeId(input.reminderId), closed(input.action, REMINDER_ACTIONS), revision(input.revision),
  ));
  handle('life:mission-intent', (client, input) => client.setLifeMissionIntent(
    closed(input.action, MISSION_ACTIONS), lifeId(input.projectId), {
      revision: revision(input.revision, true),
      ...(input.action === 'hide' ? { hiddenUntil: String(input.hiddenUntil || '').slice(0, 40) } : {}),
    },
  ));

  handle('life:mode-get', (client) => client.getLifeMode());
  handle('life:mode-set', (client, input) => client.setLifeMode({
    mode: closed(input.mode, LIFE_MODES), revision: revision(input.revision, true),
    ...(input.expiresAt === null || typeof input.expiresAt === 'string' ? { expiresAt: input.expiresAt === null ? null : String(input.expiresAt).slice(0, 40) } : {}),
  }));
  handle('life:preferences', (client) => client.getLifePreferences());
  handle('life:preference-set', (client, input) => client.setLifePreference(closed(boundedText(input.key, 80), PREFERENCE_KEYS), {
    value: input.value, revision: revision(input.revision, true),
  }));
  handle('life:preference-reset', (client, input) => client.resetLifePreference(closed(boundedText(input.key, 80), PREFERENCE_KEYS), revision(input.revision)));
  handle('life:preference-delete', (client, input) => client.deleteLifePreference(closed(boundedText(input.key, 80), PREFERENCE_KEYS), revision(input.revision)));

  handle('life:people', (client, input) => client.getLifePeople(input.includeArchived === true));
  handle('life:person-create', (client, input) => client.createLifePerson({
    displayName: boundedText(input.displayName, 160), aliases: Array.isArray(input.aliases) ? input.aliases.slice(0, 16).map((item) => boundedText(item, 160)).filter(Boolean) : [],
    relationshipType: closed(input.relationshipType, RELATIONSHIP_TYPES), notes: boundedText(input.notes, 1000),
  }));
  handle('life:relationships', (client, input) => client.getLifeRelationships(lifeId(input.personId)));
  handle('life:person-project-links', (client, input) => client.getLifePersonProjectLinks({ projectId: lifeId(input.projectId), personId: lifeId(input.personId) }));
  handle('life:family-grants', (client, input) => client.getLifeFamilyGrants({ memberUserId: lifeId(input.memberUserId), includeInactive: input.includeInactive === true }));
  handle('life:family-shared', (client) => client.getLifeFamilyShared());

  handle('life:recovery-create', (client, input) => client.createLifeRecoveryPlan(lifeId(input.projectId), revision(input.sourceContextRevision, true) || 0));
  handle('life:recovery-get', (client, input) => client.getLifeRecoveryPlan(lifeId(input.planId)));
  handle('life:recovery-propose', (client, input) => client.proposeLifeRecoveryPlan(lifeId(input.planId), revision(input.revision)));

  handle('life:sources', (client) => client.getLifeSources());
  handle('life:source-create', (client, input) => client.createLifeSource({
    adapterType: closed(input.adapterType, SOURCE_TYPES), displayName: boundedText(input.displayName, 160),
    enabled: input.enabled === true, selectedScope: boundedObject(input.selectedScope), privacyPolicyVersion: 1,
    configurationMetadata: boundedObject(input.configurationMetadata),
  }));
  handle('life:source-update', (client, input) => client.updateLifeSource(lifeId(input.sourceId), {
    revision: revision(input.revision),
    ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
    ...(typeof input.displayName === 'string' ? { displayName: boundedText(input.displayName, 160) } : {}),
  }));
  handle('life:source-sync', (client, input) => client.syncLifeSource(lifeId(input.sourceId)));
}

module.exports = { boundedObject, lifeId, registerLifeOsIpc, revision };
