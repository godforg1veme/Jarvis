const crypto = require('node:crypto');
const { LIFE_SOURCE_TYPES } = require('../life/sources/sourceSchemas');
const { PREFERENCE_KEYS } = require('../life/preferences/lifePreferenceSchemas');
const {
  FAMILY_PERMISSIONS, FAMILY_RESOURCE_TYPES, PROJECT_ROLES, RELATIONSHIP_TYPES,
} = require('../life/people/peopleSchemas');

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const MODES = Object.freeze(['work', 'focus', 'home', 'family', 'meeting', 'travel', 'rest', 'sleep', 'emergency']);
const SECTION = Object.freeze({ m: 'Миссия', t: 'Timeline', p: 'Проекты', c: 'Договорённости', o: 'Предложения', r: 'Напоминания', h: 'Люди', d: 'Режим', f: 'Предпочтения', s: 'Источники', x: 'Восстановление' });
const LIFE_CALLBACK_RE = new RegExp(`^life:(?:home|confirm:${UUID}|dismiss:${UUID}|[mtpcordhfsx](?::(?:p:[0-9]{1,3}|v:${UUID}|new|set|rel|link|grant|grants|(?:pin|replace|hide|restore|done|drop|cancel|ack|toggle|sync|recover|propose|edit|archive|feedback|revoke|apply):${UUID}(?::[0-9]{1,10})?|mode:(?:work|focus|home|family|meeting|travel|rest|sleep|emergency)(?::[0-9]{1,10})?|(?:pref|reset|remove):[0-8](?::[0-9]{1,10})?))?)$`, 'i');

function isLifeCallback(value) {
  const data = String(value || '');
  return Buffer.byteLength(data, 'utf8') <= 64 && LIFE_CALLBACK_RE.test(data);
}

function nav(parent = 'home') {
  return [[{ text: parent === 'home' ? '🏠 Life OS' : '← Назад', data: `life:${parent}` }]];
}

function page(items, index, size = 8) {
  const current = Math.max(0, Number(index) || 0);
  return { current, values: items.slice(current * size, current * size + size), hasPrevious: current > 0, hasNext: (current + 1) * size < items.length };
}

function date(value) {
  return value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'без срока';
}

function safe(value, maximum = 160) { return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, maximum); }

class TelegramLifeOsService {
  constructor(options = {}) { Object.assign(this, options); }

  async home(context) {
    if (!this.missionControlService) return { answer: 'Life OS пока не включён.' };
    const data = await this.missionControlService.get({ userId: context.user.id });
    const mission = data.currentMission?.name || 'не выбрана';
    const mode = data.mode?.mode || 'work';
    return { answer: `Life OS\nМиссия: ${mission}\nРежим: ${mode}\nОткрытых договорённостей: ${data.commitments.length}\nПредложений: ${data.proposals.length}`,
      buttons: [
        [{ text: '🧭 Миссия', data: 'life:m' }, { text: '🕓 Timeline', data: 'life:t' }],
        [{ text: '📁 Проекты', data: 'life:p' }, { text: '✅ Договорённости', data: 'life:c' }],
        [{ text: '💡 Предложения', data: 'life:o' }, { text: '🔔 Напоминания', data: 'life:r' }],
        [{ text: '👥 Люди', data: 'life:h' }, { text: '🎭 Режим', data: 'life:d' }],
        [{ text: '⚙️ Предпочтения', data: 'life:f' }, { text: '🔌 Источники', data: 'life:s' }],
        [{ text: '↩️ Восстановить контекст', data: 'life:x' }],
      ] };
  }

  async handleCallback(data, context) {
    if (!isLifeCallback(data)) return null;
    if (data === 'life:home') return this.home(context);
    if (/^life:(?:confirm|dismiss):/i.test(data)) return null;
    const parts = data.split(':'); const section = parts[1]; const action = parts[2] || '';
    if (!SECTION[section]) return null;
    try {
      if (!action || action === 'p') return this._list(section, action === 'p' ? parts[3] : 0, context);
      if (action === 'v') return this._view(section, parts[3], context);
      if (action === 'new' || action === 'set') return this._startFlow(section, context);
      return this._mutate(section, action, parts.slice(3), context);
    } catch (_) { return { answer: 'Раздел временно недоступен или данные изменились. Обнови экран.', buttons: nav() }; }
  }

  async _list(section, pageNumber, context) {
    const userId = context.user.id;
    if (section === 'm') {
      const data = await this.missionControlService.get({ userId }); const mission = data.currentMission;
      const reasons = (mission?.reasons || []).map((item) => `• ${safe(item.label || item.code)}: ${item.value ?? ''}`).join('\n');
      const buttons = (data.rankedProjects || []).slice(0, 6).map((item) => [{ text: `📌 ${safe(item.name, 22)}`, data: `life:m:pin:${item.id}:${item.priorityRevision || 0}` }, { text: 'Заменить', data: `life:m:replace:${item.id}:${item.priorityRevision || 0}` }]);
      if (mission) buttons.push([{ text: '🙈 Скрыть текущую', data: `life:m:hide:${mission.id}:${mission.priorityRevision || 0}` }]);
      return { answer: `Текущая миссия: ${mission?.name || 'не выбрана'}${reasons ? `\nПочему:\n${reasons}` : ''}\nСледующий шаг: ${data.nextStep?.title || 'не определён'}`, buttons: [...buttons, ...nav()] };
    }
    let items = [];
    if (section === 't') items = (await this.timelineService.list({ userId, limit: 100 })).items;
    if (section === 'p') items = await this.repository.listProjects({ userId, statuses: ['active', 'paused', 'completed', 'archived'], limit: 100 });
    if (section === 'c') items = await this.repository.listCommitments({ userId, statuses: ['open', 'completed', 'dismissed', 'expired'], limit: 100 });
    if (section === 'o') items = await this.repository.listProposals({ userId, statuses: ['open', 'executing', 'outcome_unknown', 'completed', 'failed', 'dismissed'], limit: 100 });
    if (section === 'r') items = await this.reminderRepository.list({ userId, states: ['scheduled', 'claimed', 'delivered', 'acknowledged', 'cancelled', 'failed', 'outcome_unknown'], limit: 100 });
    if (section === 'h') items = await this.peopleService.list({ userId, includeArchived: true });
    if (section === 'd') return this._modes(context);
    if (section === 'f') return this._preferences(context);
    if (section === 's') items = await this.sourceRepository.list({ userId });
    if (section === 'x') items = await this.repository.listProjects({ userId, statuses: ['active', 'paused'], limit: 100 });
    const result = page(items, pageNumber);
    const lines = result.values.map((item, i) => `${result.current * 8 + i + 1}. ${safe(item.summary || item.name || item.title || item.display_name || item.displayName || item.type || item.adapter_type || item.event_type)}${item.status || item.state ? ` — ${item.status || item.state}` : ''}`);
    const buttons = result.values.map((item) => [{ text: safe(item.name || item.title || item.display_name || item.summary || item.event_type, 42) || 'Открыть', data: `life:${section}:v:${item.id}` }]);
    const pages = []; if (result.hasPrevious) pages.push({ text: '⬅️', data: `life:${section}:p:${result.current - 1}` }); if (result.hasNext) pages.push({ text: '➡️', data: `life:${section}:p:${result.current + 1}` });
    if (pages.length) buttons.push(pages);
    if (['p', 'r', 'h', 's'].includes(section)) buttons.push([{ text: '➕ Добавить', data: `life:${section}:new` }]);
    if (section === 'h') buttons.push([{ text: '🔗 Связь', data: 'life:h:rel' }, { text: '📁 К проекту', data: 'life:h:link' }], [{ text: '👨‍👩‍👧 Доступы', data: 'life:h:grants' }, { text: '➕ Дать доступ', data: 'life:h:grant' }]);
    return { answer: `${SECTION[section]}${lines.length ? `\n${lines.join('\n')}` : '\nПока пусто.'}`, buttons: [...buttons, ...nav()] };
  }

  async _view(section, id, context) {
    const userId = context.user.id; let item; let buttons = [];
    if (section === 't') { item = (await this.timelineService.list({ userId, limit: 100 })).items.find((row) => row.id === id); }
    if (section === 'p' || section === 'x') item = await this.repository.getProject({ userId, projectId: id });
    if (section === 'c') item = await this.repository.getCommitment({ userId, commitmentId: id });
    if (section === 'o') item = await this.repository.getProposal({ userId, proposalId: id });
    if (section === 'r') item = await this.reminderRepository.get({ userId, reminderId: id });
    if (section === 'h') item = (await this.peopleService.list({ userId, includeArchived: true })).find((row) => row.id === id);
    if (section === 's') item = await this.sourceRepository.get({ userId, connectionId: id });
    if (!item) return { answer: 'Объект уже недоступен.', buttons: nav(section) };
    if (section === 't') buttons.push([{ text: '🙈 Скрыть из Timeline', data: `life:t:feedback:${item.id}` }]);
    if (section === 'p') { buttons.push([{ text: '✏️ Изменить', data: `life:p:edit:${item.id}:${item.revision}` }, { text: '🗄 Архив', data: `life:p:archive:${item.id}:${item.revision}` }], [{ text: '↩️ Подготовить восстановление', data: `life:x:recover:${item.id}:${item.revision}` }]); }
    if (section === 'x') { buttons.push([{ text: '↩️ Подготовить план', data: `life:x:recover:${item.id}:${item.revision}` }]); }
    if (section === 'c' && item.status === 'open') buttons.push([{ text: '✅ Выполнено', data: `life:c:done:${item.id}:${item.revision}` }, { text: '✖️ Отменить', data: `life:c:drop:${item.id}:${item.revision}` }]);
    if (section === 'o' && item.status === 'open') buttons.push([{ text: '✅ Принять', data: `life:confirm:${item.id}` }, { text: 'Не сейчас', data: `life:dismiss:${item.id}` }]);
    if (section === 'r' && ['scheduled', 'failed', 'outcome_unknown'].includes(item.state)) buttons.push([{ text: '🕓 Перенести', data: `life:r:edit:${item.id}:${item.revision}` }, { text: '✖️ Отменить', data: `life:r:cancel:${item.id}:${item.revision}` }]);
    if (section === 'r' && ['delivered', 'claimed'].includes(item.state)) buttons.push([{ text: '✅ Прочитано', data: `life:r:ack:${item.id}:${item.revision}` }]);
    if (section === 'h') buttons.push([{ text: '✏️ Изменить', data: `life:h:edit:${item.id}:${item.revision}` }, { text: item.status === 'archived' ? '♻️ Вернуть' : '🗄 Архив', data: `life:h:archive:${item.id}:${item.revision}` }]);
    if (section === 's') buttons.push([{ text: '✏️ Название', data: `life:s:edit:${item.id}:${item.revision}` }, { text: item.enabled ? '⏸ Отключить' : '▶️ Включить', data: `life:s:toggle:${item.id}:${item.revision}` }], [{ text: '🔄 Синхронизировать', data: `life:s:sync:${item.id}:${item.revision}` }]);
    const text = [item.name || item.title || item.display_name || item.summary || item.event_type, item.summary, item.explanation, item.relationship_type, item.adapter_type, item.status || item.state, item.due_at || item.trigger_at ? date(item.due_at || item.trigger_at) : ''].filter(Boolean).map((value) => safe(value, 1000)).join('\n');
    return { answer: text || 'Данные доступны.', buttons: [...buttons, ...nav(section)] };
  }

  async _modes(context) {
    const current = await this.modeService.get({ userId: context.user.id });
    return { answer: `Текущий режим: ${current.mode}`, buttons: [...MODES.map((mode) => [{ text: `${mode === current.mode ? '✅ ' : ''}${mode}`, data: `life:d:mode:${mode}:${current.revision || 0}` }]), ...nav()] };
  }

  async _preferences(context) {
    const values = await this.preferenceService.list({ userId: context.user.id });
    return { answer: `Предпочтения\n${values.map((item, i) => `${i + 1}. ${item.key}: ${safe(JSON.stringify(item.value), 120)}`).join('\n')}`,
      buttons: [...values.map((item, index) => [{ text: `✏️ ${safe(item.key, 24)}`, data: `life:f:pref:${index}:${item.revision || 0}` }, { text: '↺', data: `life:f:reset:${index}:${item.revision || 0}` }, { text: '🗑', data: `life:f:remove:${index}:${item.revision || 0}` }]), ...nav()] };
  }

  async _startFlow(section, context) {
    const definitions = { p: ['life_project_create', 'Напиши: название | описание'], r: ['life_reminder_create', 'Напиши: название | дата и время ISO'], h: ['life_person_create', `Напиши: имя | тип отношений\nТипы: ${RELATIONSHIP_TYPES.join(', ')}`], s: ['life_source_create', `Напиши: тип | название\nТипы: ${LIFE_SOURCE_TYPES.join(', ')}`] };
    if (section === 'f') return null;
    const definition = definitions[section]; if (!definition || !this.interactions) return { answer: 'Пошаговый ввод недоступен.', buttons: nav(section) };
    const interaction = await this.interactions.begin({ userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId, kind: definition[0], context: {} });
    return { answer: definition[1], buttons: [[{ text: '✖️ Отмена', data: `flow:cancel:${interaction.id}` }]] };
  }

  async _mutate(section, action, args, context) {
    const userId = context.user.id; const id = args[0]; const revision = Number(args[1]); let updated;
    if (section === 'm') updated = action === 'pin' ? await this.missionControlService.pin({ userId, projectId: id, revision: revision || null }) : action === 'replace' ? await this.missionControlService.replace({ userId, projectId: id, revision: revision || null }) : action === 'hide' ? await this.missionControlService.hide({ userId, projectId: id, revision: revision || null, hiddenUntil: new Date(Date.now() + 86400000) }) : await this.missionControlService.restore({ userId, projectId: id, revision: revision || null });
    if (section === 't' && action === 'feedback') updated = await this.repository.recordFeedback({ userId, kind: 'hide', targetType: 'event', targetId: id, note: 'Скрыто через Telegram Life OS' });
    if (section === 'p' && action === 'archive') updated = await this.projectService.update({ userId, projectId: id, input: { revision, status: 'archived' } });
    if (section === 'c') updated = await this.repository.updateCommitment({ userId, commitmentId: id, revision, status: action === 'done' ? 'completed' : 'dismissed' });
    if (section === 'r' && action === 'cancel') updated = await this.reminderService.cancel({ userId, reminderId: id, revision });
    if (section === 'r' && action === 'ack') updated = await this.reminderService.acknowledge({ userId, reminderId: id, revision });
    if (section === 'd' && action === 'mode') updated = await this.modeService.setManual({ userId, input: { mode: id, revision: revision || null } });
    if (section === 'f' && action === 'pref') {
      const key = PREFERENCE_KEYS[Number(id)]; if (!key) return { answer: 'Настройка недоступна.', buttons: nav('f') };
      const interaction = await this.interactions.begin({ userId, conversationId: context.conversation.id, chatId: context.chatId, kind: 'life_preference_set', context: { key, revision: revision || null } });
      return { answer: `Новое значение для ${key}. Для объектов используй JSON.`, buttons: [[{ text: '✖️ Отмена', data: `flow:cancel:${interaction.id}` }]] };
    }
    if (section === 'f' && ['reset', 'remove'].includes(action)) {
      const key = PREFERENCE_KEYS[Number(id)]; if (!key || !revision) return { answer: 'Для настройки уже используется значение по умолчанию.', buttons: nav('f') };
      updated = action === 'reset' ? await this.preferenceService.reset({ userId, key, revision }) : await this.preferenceService.remove({ userId, key, revision });
    }
    if (section === 'h' && action === 'archive') {
      const person = (await this.peopleService.list({ userId, includeArchived: true })).find((row) => row.id === id);
      updated = person && await this.peopleService.update({ userId, personId: id, input: { revision, status: person.status === 'archived' ? 'active' : 'archived' } });
    }
    if (section === 'h' && action === 'grants') return this._familyGrants(context);
    if (section === 'h' && ['rel', 'link', 'grant'].includes(action)) return this._startPeopleFlow(action, context);
    if (section === 'h' && action === 'revoke') updated = await this.familyAccessService.revoke({ userId, grantId: id, revision });
    if (section === 'h' && action === 'apply') {
      const active = await this.interactions.getActive({ userId, conversationId: context.conversation.id, chatId: context.chatId });
      if (!active.interaction || active.interaction.id !== id || active.interaction.kind !== 'life_family_grant_confirm') return { answer: 'Подтверждение уже недоступно.', buttons: nav('h') };
      const consumed = await this.interactions.consume({ id, userId, conversationId: context.conversation.id, chatId: context.chatId });
      updated = consumed && await this.familyAccessService.create({ userId, input: consumed.context });
    }
    if (['p', 'h', 'r', 's'].includes(section) && action === 'edit') {
      const kinds = { p: 'life_project_update', h: 'life_person_update', r: 'life_reminder_reschedule', s: 'life_source_update' };
      const prompts = { p: 'Напиши: название | описание | статус (active/paused/completed/archived)', h: `Напиши: имя | тип отношений | заметка\nТипы: ${RELATIONSHIP_TYPES.join(', ')}`, r: 'Напиши новую дату и время ISO', s: 'Напиши новое название источника' };
      const interaction = await this.interactions.begin({ userId, conversationId: context.conversation.id, chatId: context.chatId, kind: kinds[section], context: { targetId: id, revision } });
      return { answer: prompts[section], buttons: [[{ text: '✖️ Отмена', data: `flow:cancel:${interaction.id}` }]] };
    }
    if (section === 's' && action === 'toggle') { const source = await this.sourceRepository.get({ userId, connectionId: id }); updated = source && await this.sourceRepository.update({ userId, connectionId: id, revision, enabled: !source.enabled }); }
    if (section === 's' && action === 'sync') { const result = await this.sourceSyncService.sync({ userId, connectionId: id }); return { answer: `Синхронизация: ${result.status}; принято: ${result.accepted}`, buttons: nav('s') }; }
    if (section === 'x' && action === 'recover') { const plan = await this.recoveryPlanService.createPreview({ userId, projectId: id, sourceContextRevision: revision, originChannel: 'telegram', originConversationId: context.conversation.id }); if (!plan) updated = null; else return { answer: `${plan.summary}\n${plan.steps.map((step) => `• ${step.label}`).join('\n')}`, buttons: [[{ text: '✅ Создать предложение', data: `life:x:propose:${plan.id}:${plan.revision}` }], ...nav('x')] }; }
    if (section === 'x' && action === 'propose') { const result = await this.recoveryPlanService.propose({ userId, planId: id, revision }); if (!result) updated = null; else return { answer: 'План подготовлен как подтверждаемое предложение.', buttons: [[{ text: '✅ Подтвердить', data: `life:confirm:${result.proposalId}` }, { text: 'Не сейчас', data: `life:dismiss:${result.proposalId}` }], ...nav('x')] }; }
    return { answer: updated ? 'Life OS обновлён.' : 'Данные изменились или недоступны. Обнови экран.', buttons: nav(section) };
  }

  async _startPeopleFlow(action, context) {
    const definitions = {
      rel: ['life_relationship_create', 'Напиши: ID человека | тип связи'],
      link: ['life_project_link_create', `Напиши: ID человека | ID проекта | роль\nРоли: ${PROJECT_ROLES.join(', ')}`],
      grant: ['life_family_grant_create', `Напиши: ID пользователя | тип ресурса | ID ресурса | право\nРесурсы: ${FAMILY_RESOURCE_TYPES.join(', ')}\nПрава: ${FAMILY_PERMISSIONS.join(', ')}`],
    };
    const [kind, answer] = definitions[action];
    const interaction = await this.interactions.begin({ userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId, kind, context: {} });
    return { answer, buttons: [[{ text: '✖️ Отмена', data: `flow:cancel:${interaction.id}` }]] };
  }

  async _familyGrants(context) {
    const grants = await this.familyAccessService.listOwned({ userId: context.user.id, includeInactive: true });
    return { answer: `Семейные доступы${grants.length ? `\n${grants.map((item, index) => `${index + 1}. ${item.resource_type} · ${item.permission}${item.revoked_at ? ' · отозван' : ''}`).join('\n')}` : '\nПока пусто.'}`,
      buttons: [...grants.filter((item) => !item.revoked_at).map((item) => [{ text: `Отозвать ${safe(item.resource_type, 20)}`, data: `life:h:revoke:${item.id}:${item.revision}` }]), ...nav('h')] };
  }

  async handlePendingText(text, context, active) {
    const parts = String(text || '').split('|').map((item) => item.trim()); const userId = context.user.id; let result;
    if (active.kind === 'life_project_create') result = await this.projectService.create({ userId, input: { name: parts[0], summary: parts[1] || '', areaId: null, targetAt: null } });
    if (active.kind === 'life_project_update') result = await this.projectService.update({ userId, projectId: active.context.targetId, input: { revision: active.context.revision, name: parts[0], summary: parts[1] || '', status: parts[2] || 'active' } });
    if (active.kind === 'life_person_create') result = await this.peopleService.create({ userId, input: { displayName: parts[0], relationshipType: RELATIONSHIP_TYPES.includes(parts[1]) ? parts[1] : 'other', aliases: [], notes: '' } });
    if (active.kind === 'life_person_update') result = await this.peopleService.update({ userId, personId: active.context.targetId, input: { revision: active.context.revision, displayName: parts[0], relationshipType: parts[1], notes: parts[2] || '' } });
    if (active.kind === 'life_relationship_create') result = await this.peopleService.createRelationship({ userId, input: { personId: parts[0], relatedPersonId: null, direction: 'mutual', relationType: parts[1], origin: 'user', confidence: 1 } });
    if (active.kind === 'life_project_link_create') result = await this.peopleService.createProjectLink({ userId, input: { personId: parts[0], projectId: parts[1], role: parts[2] } });
    if (active.kind === 'life_family_grant_create') {
      const grant = { memberUserId: parts[0], resourceType: parts[1], resourceId: parts[2], permission: parts[3] };
      const confirmation = await this.interactions.begin({ userId, conversationId: context.conversation.id, chatId: context.chatId, kind: 'life_family_grant_confirm', context: grant });
      return { answer: `Предоставить доступ ${safe(grant.memberUserId, 36)} к ${safe(grant.resourceType, 30)} с правом ${safe(grant.permission, 30)}?`, buttons: [[{ text: '✅ Предоставить', data: `life:h:apply:${confirmation.id}` }, { text: '✖️ Отмена', data: `flow:cancel:${confirmation.id}` }]] };
    }
    if (active.kind === 'life_reminder_create') result = await this.reminderService.create({ userId, origin: { channel: 'telegram', conversationId: context.conversation.id }, input: { requestId: crypto.randomUUID(), title: parts[0], triggerAt: new Date(parts[1]).toISOString(), timezone: 'Europe/Moscow', deliveryChannels: ['telegram'] } });
    if (active.kind === 'life_reminder_reschedule') result = await this.reminderService.reschedule({ userId, reminderId: active.context.targetId, revision: active.context.revision, triggerAt: new Date(parts[0]).toISOString(), timezone: 'Europe/Moscow', recurrence: null });
    if (active.kind === 'life_source_create') result = LIFE_SOURCE_TYPES.includes(parts[0]) && await this.sourceRepository.create({ userId, adapterType: parts[0], displayName: parts[1], enabled: false, selectedScope: {}, privacyPolicyVersion: 1, configurationMetadata: {} });
    if (active.kind === 'life_source_update') result = await this.sourceRepository.update({ userId, connectionId: active.context.targetId, revision: active.context.revision, displayName: parts[0] });
    if (active.kind === 'life_preference_set') { let value; try { value = JSON.parse(String(text)); } catch (_) { value = String(text).trim(); } result = await this.preferenceService.set({ userId, key: active.context.key, value, revision: active.context.revision }); }
    return result ? { answer: 'Life OS обновлён.', buttons: nav() } : { answer: 'Не удалось применить значение. Проверь формат и актуальность данных.' };
  }
}

module.exports = { LIFE_CALLBACK_RE, MODES, SECTION, TelegramLifeOsService, isLifeCallback };
