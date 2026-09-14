const { publicDocumentStatus } = require('../knowledge/knowledgeService');
const { containsSensitiveMemoryData, normalizeMemoryContent } = require('../memory/memoryService');
const { normalizeDeviceName } = require('../devices/deviceService');
const { validateAction: validateVpnAction } = require('../vpn/vpnCommandService');
const { MENU, isOwner, replyKeyboard } = require('./telegramMenu');

function memoryMenu() {
  return [
    [{ text: '📋 Что ты помнишь', data: 'mem:list' }],
    [{ text: '➕ Запомнить', data: 'mem:add' }, { text: '✏️ Исправить', data: 'mem:correct' }],
    [{ text: '🗑 Забыть', data: 'mem:forget' }],
    [{ text: '🖼 Файлы и кадры', data: 'gallery:page:0' }],
  ];
}

function deviceMenu() {
  return [
    [{ text: '📋 Мои устройства', data: 'dev:list' }],
    [{ text: '➕ Подключить компьютер', data: 'dev:pair' }],
  ];
}

function interactionCancel(id) {
  return [[{ text: '✖️ Отмена', data: `flow:cancel:${id}` }]];
}

function memoryError(result) {
  if (result?.code === 'MEMORY_SENSITIVE') return 'Я не сохраняю пароли, токены, ключи и платёжные данные. Напиши другой факт.';
  if (result?.code === 'MEMORY_NOT_FOUND') return 'Этот факт уже недоступен. Открой актуальный список памяти.';
  return 'Сообщение пустое. Напиши значение обычным текстом.';
}

class TelegramMenuService {
  constructor(options = {}) {
    this.interactions = options.interactions;
    this.deviceService = options.deviceService || null;
    this.memoryService = options.memoryService || null;
    this.knowledgeService = options.knowledgeService || null;
    this.vpnService = options.vpnService || null;
    this.lifeMissionControlService = options.lifeMissionControlService || null;
    this.memoryGalleryService = options.memoryGalleryService || null;
    this.ownerTelegramId = String(options.ownerTelegramId || '0');
    this.operationsEnabled = options.operationsEnabled === true;
    const configuredOperationsUrl = this.operationsEnabled && options.operationsPublicOrigin
      ? new URL('/ops/', options.operationsPublicOrigin)
      : null;
    this.operationsPanelUrl = configuredOperationsUrl?.protocol === 'https:' ? configuredOperationsUrl.toString() : null;
  }

  owner(context) {
    return isOwner(context.user, context.telegramUserId, this.ownerTelegramId);
  }

  keyboard(context) {
    return replyKeyboard(this.owner(context));
  }

  async _cancel(context, id = null) {
    if (!this.interactions) return false;
    return this.interactions.cancel({
      id, userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId,
    });
  }

  async _begin(context, kind, interactionContext, answer) {
    if (!this.interactions) return { answer: 'Пошаговый ввод сейчас недоступен.' };
    const interaction = await this.interactions.begin({
      userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId,
      kind, context: interactionContext,
    });
    return { answer, buttons: interactionCancel(interaction.id) };
  }

  async handleMenuAction(action, context) {
    if (!action) return null;
    await this._cancel(context);
    if (action === 'home') {
      const admin = this.owner(context) ? ' Доступны также VPN и Operations.' : '';
      return { answer: `Jarvis готов. Выбери раздел снизу или напиши вопрос обычным текстом.${admin}`, replyKeyboard: this.keyboard(context) };
    }
    if (action === 'help') {
      return {
        answer: 'Можно писать вопросы, отправлять голосовые и файлы. Разделы снизу открывают Life OS, память, документы и устройства. Действия с последствиями подтверждаются отдельными кнопками под сообщением. Старые команды остаются запасным способом управления.',
        replyKeyboard: this.keyboard(context),
      };
    }
    if (action === 'memory') return this.memoryService ? this._memoryHome(context) : { answer: 'Память сейчас недоступна.' };
    if (action === 'documents') return this._documents(context);
    if (action === 'devices') return { answer: 'Управление компьютерами:', buttons: deviceMenu() };
    if (action === 'life') return this._life(context);
    if (action === 'vpn') {
      if (!this.owner(context) || !this.vpnService) return { answer: 'Управление VPN недоступно.' };
      return this.vpnService.openMenu(context);
    }
    if (action === 'operations') {
      if (!this.owner(context) || !this.operationsPanelUrl) return { answer: 'Operations-панель сейчас недоступна.' };
      return {
        answer: 'Operations показывает состояние сервисов, инциденты и безопасные административные действия. Вход в браузере нужно отдельно подтвердить здесь, в Telegram.',
        buttons: [[{ text: '🌐 Открыть Operations', url: this.operationsPanelUrl }]],
      };
    }
    return null;
  }

  async _life(context) {
    if (!this.lifeMissionControlService) return { answer: 'Life OS пока не включён.' };
    const data = await this.lifeMissionControlService.get({ userId: context.user.id });
    const mission = data.currentMission ? `Текущая миссия: ${data.currentMission.name}` : 'Текущая миссия не выбрана.';
    const commitments = data.commitments.slice(0, 5).map((item) => `• ${item.title}${item.dueAt ? ` — ${new Date(item.dueAt).toLocaleString('ru-RU')}` : ''}`).join('\n');
    const proposals = data.proposals.slice(0, 5);
    const proposalText = proposals.map((item) => `• ${item.title}`).join('\n');
    return {
      answer: [mission, commitments ? `\nДоговорённости:\n${commitments}` : '', proposalText ? `\nПредложения:\n${proposalText}` : ''].join('').slice(0, 10000),
      buttons: proposals.length ? proposals.map((item) => [
        { text: `✅ Принять «${item.title.slice(0, 20)}»`, data: `life:confirm:${item.id}` },
        { text: 'Не сейчас', data: `life:dismiss:${item.id}` },
      ]) : undefined,
    };
  }

  async _memoryHome() {
    return { answer: 'Управление памятью Jarvis:', buttons: memoryMenu() };
  }

  async _memoryList(context, action) {
    if (!this.memoryService) return { answer: 'Память сейчас недоступна.' };
    const memories = await this.memoryService.list({ userId: context.user.id, limit: 30 });
    if (!memories.length) return { answer: 'Пока ничего не сохранено.', buttons: memoryMenu() };
    if (action === 'list') return {
      answer: `Я помню:\n${memories.map((item, index) => `${index + 1}. ${item.content}`).join('\n')}`,
      buttons: memoryMenu(),
    };
    const prefix = action === 'correct' ? 'edit' : 'forget_prompt';
    return {
      answer: action === 'correct' ? 'Какой факт исправить?' : 'Какой факт забыть?',
      buttons: [
        ...memories.slice(0, 20).map((item) => [{ text: item.content.slice(0, 48), data: `mem:${prefix}:${item.id}` }]),
        [{ text: '← В память', data: 'mem:menu' }],
      ],
    };
  }

  async _documents(context) {
    if (!this.knowledgeService) return { answer: 'Документы сейчас недоступны.' };
    const documents = await this.knowledgeService.list({ userId: context.user.id });
    const text = documents.length
      ? documents.map((doc) => `${doc.original_name}\n${publicDocumentStatus(doc)} · ${doc.category}`).join('\n\n')
      : 'Личных документов пока нет.';
    return {
      answer: text,
      buttons: [
        [{ text: '➕ Добавить документ', data: 'doc:add' }],
        ...documents.slice(0, 20).map((doc) => [{ text: `🗑 ${doc.original_name.slice(0, 42)}`, data: `doc:del_prompt:${doc.id}` }]),
      ],
    };
  }

  async _devices(context) {
    if (!this.deviceService) return { answer: 'Устройства сейчас недоступны.', buttons: deviceMenu() };
    const devices = await this.deviceService.list({ userId: context.user.id });
    const active = devices.filter((device) => device.status !== 'revoked').slice(0, 20);
    return {
      answer: devices.length ? devices.map((device) => `${device.name} — ${device.status}`).join('\n') : 'Подключённых устройств пока нет.',
      buttons: [
        ...active.map((device) => [{ text: `${device.status === 'online' ? '🟢' : '⚪'} ${device.name.slice(0, 44)}`, data: `dev:select:${device.id}` }]),
        [{ text: '➕ Подключить компьютер', data: 'dev:pair' }],
      ],
    };
  }

  async handleCallback(data, context) {
    data = String(data || '');
    const flow = /^flow:cancel:([a-f0-9-]{36})$/i.exec(data);
    if (flow) {
      const cancelled = await this._cancel(context, flow[1]);
      return { answer: cancelled ? 'Действие отменено.' : 'Этот запрос уже недоступен.' };
    }

    if (data.startsWith('gallery:')) {
      await this._cancel(context);
      return this.memoryGalleryService
        ? this.memoryGalleryService.handleCallback(data, context)
        : { answer: 'Файлы и кадры сейчас недоступны.', buttons: memoryMenu() };
    }

    if (/^(?:mem|doc|dev|life):/.test(data) || /^vpn:(?!confirm:|reject:)/.test(data)) {
      await this._cancel(context);
    }

    if (data.startsWith('vpn:')) {
      if (!this.owner(context) || !this.vpnService) return { answer: 'Управление VPN недоступно.' };
      const result = await this.vpnService.handleCallback(context);
      if (result?.requestInput) return this._begin(context, result.requestInput.kind, result.requestInput.context, result.answer);
      return result;
    }

    if (data.startsWith('mem:') && !this.memoryService) return { answer: 'Память сейчас недоступна.' };
    if (data === 'mem:menu') return this._memoryHome(context);
    if (data === 'mem:list') return this._memoryList(context, 'list');
    if (data === 'mem:add') return this._begin(context, 'memory_add', {}, 'Что мне запомнить? Напиши один факт обычным сообщением.');
    if (data === 'mem:correct') return this._memoryList(context, 'correct');
    if (data === 'mem:forget') return this._memoryList(context, 'forget');
    let match = /^mem:edit:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const memory = (await this.memoryService.list({ userId: context.user.id, limit: 100 })).find((item) => item.id === match[1]);
      if (!memory) return { answer: 'Этот факт уже недоступен.', buttons: memoryMenu() };
      return this._begin(context, 'memory_correct_replacement', { memoryId: memory.id }, `Напиши новое значение вместо «${memory.content.slice(0, 200)}».`);
    }
    match = /^mem:forget_prompt:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const memory = (await this.memoryService.list({ userId: context.user.id, limit: 100 })).find((item) => item.id === match[1]);
      if (!memory) return { answer: 'Этот факт уже недоступен.', buttons: memoryMenu() };
      return { answer: `Забыть факт «${memory.content.slice(0, 300)}»?`, buttons: [[
        { text: '✅ Да, забыть', data: `mem:forget_confirm:${memory.id}` },
        { text: '✖️ Отмена', data: 'mem:menu' },
      ]] };
    }
    match = /^mem:forget_confirm:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const result = await this.memoryService.forgetById({ userId: context.user.id, memoryId: match[1] });
      return { answer: result.ok ? 'Забыл.' : 'Этот факт уже недоступен.', buttons: memoryMenu() };
    }

    if (data.startsWith('doc:') && !this.knowledgeService) return { answer: 'Документы сейчас недоступны.' };
    if (data === 'doc:menu') return this._documents(context);
    if (data === 'doc:add') return { answer: 'Пришли файл прямо в этот чат. Я приму его, проверю размер и поставлю на индексацию.', buttons: [[{ text: '← К документам', data: 'doc:menu' }]] };
    match = /^doc:del_prompt:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const doc = (await this.knowledgeService.list({ userId: context.user.id })).find((item) => item.id === match[1]);
      if (!doc) return { answer: 'Документ уже недоступен.', buttons: [[{ text: '← К документам', data: 'doc:menu' }]] };
      return { answer: `Удалить документ «${doc.original_name}»? Удаление необратимо.`, buttons: [[
        { text: '🗑 Да, удалить', data: `doc:delete:${doc.id}` }, { text: '✖️ Отмена', data: 'doc:cancel' },
      ]] };
    }
    match = /^doc:delete:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const deleted = await this.knowledgeService.remove({ userId: context.user.id, documentId: match[1] });
      return { answer: deleted ? `Документ «${deleted.original_name}» удалён.` : 'Документ уже недоступен.', buttons: [[{ text: '← К документам', data: 'doc:menu' }]] };
    }
    if (data === 'doc:cancel') return this._documents(context);

    if (data.startsWith('dev:') && !this.deviceService) return { answer: 'Устройства сейчас недоступны.' };
    if (data === 'dev:menu') return { answer: 'Управление компьютерами:', buttons: deviceMenu() };
    if (data === 'dev:list') return this._devices(context);
    if (data === 'dev:pair') return this._begin(context, 'device_pairing_name', {}, 'Как назвать этот компьютер? Например: Домашний ПК');
    match = /^dev:select:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const device = (await this.deviceService.list({ userId: context.user.id })).find((item) => item.id === match[1] && item.status !== 'revoked');
      if (!device) return { answer: 'Устройство уже недоступно.', buttons: deviceMenu() };
      return { answer: `${device.name} — ${device.status}. Что сделать?`, buttons: [
        [{ text: '🎮 Дать поручение', data: `dev:task:${device.id}` }],
        [{ text: '⛔ Отозвать доступ', data: `dev:revoke_prompt:${device.id}` }],
        [{ text: '← К устройствам', data: 'dev:list' }],
      ] };
    }
    match = /^dev:task:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const device = (await this.deviceService.list({ userId: context.user.id })).find((item) => item.id === match[1] && item.status !== 'revoked');
      if (!device) return { answer: 'Устройство уже недоступно.', buttons: deviceMenu() };
      return this._begin(context, 'device_instruction', { deviceId: device.id }, `Что сделать на «${device.name}»? Опиши одним сообщением.`);
    }
    match = /^dev:revoke_prompt:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const device = (await this.deviceService.list({ userId: context.user.id })).find((item) => item.id === match[1] && item.status !== 'revoked');
      if (!device) return { answer: 'Устройство уже недоступно.', buttons: deviceMenu() };
      return { answer: `Отозвать доступ у «${device.name}»?`, buttons: [[
        { text: '✅ Да, отозвать', data: `dev:revoke:${device.id}` }, { text: '✖️ Отмена', data: 'dev:cancel' },
      ]] };
    }
    match = /^dev:revoke:([a-f0-9-]{36})$/i.exec(data);
    if (match) {
      const revoked = await this.deviceService.revoke({ userId: context.user.id, deviceId: match[1] });
      return { answer: revoked ? `Доступ устройства «${revoked.name}» отозван.` : 'Устройство уже недоступно.', buttons: deviceMenu() };
    }
    if (data === 'dev:cancel') return { answer: 'Отзыв доступа отменён.', buttons: deviceMenu() };
    return null;
  }

  async handlePendingText(text, context) {
    if (!this.interactions) return null;
    const active = await this.interactions.getActive({
      userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId,
    });
    if (!active.interaction) return active.expired ? { answer: 'Время ввода закончилось. Открой нужный раздел и начни ещё раз.' } : null;
    const interaction = active.interaction;
    const value = String(text || '').trim();
    if (!value) return { answer: 'Напиши значение обычным текстом.', buttons: interactionCancel(interaction.id) };

    if (interaction.kind === 'vpn_access_label') {
      try {
        validateVpnAction('issue', { protocol: interaction.context.protocol, label: value });
        const consumed = await this.interactions.consume({ id: interaction.id, userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId });
        if (!consumed) return { answer: 'Этот запрос уже недоступен.' };
        const result = await this.vpnService.requestAction({
          action: 'issue', protocol: interaction.context.protocol, arguments: { label: value },
          userId: context.user.id, conversationId: context.conversation.id, originChannel: 'telegram', originDeviceId: null,
        });
        return result;
      } catch (error) {
        if (error?.publicCode === 'VPN_LABEL_INVALID') return { answer: 'Имя должно содержать от 1 до 40 букв, цифр, пробелов, точек, дефисов или подчёркиваний.', buttons: interactionCancel(interaction.id) };
        throw error;
      }
    }

    if (interaction.kind === 'device_pairing_name') {
      let deviceName;
      try { deviceName = normalizeDeviceName(value); } catch (_) {
        return { answer: 'Имя компьютера должно содержать от 1 до 100 символов.', buttons: interactionCancel(interaction.id) };
      }
      const consumed = await this.interactions.consume({ id: interaction.id, userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId });
      if (!consumed) return { answer: 'Этот запрос уже недоступен.' };
      const pairing = await this.deviceService.beginPairing({ userId: context.user.id, deviceName });
      return { answer: `Код для «${deviceName}»: ${pairing.code}\nОткрой Jarvis Desktop и введи его в течение 10 минут.` };
    }

    if (interaction.kind === 'memory_add') {
      const normalized = normalizeMemoryContent(value);
      if (!normalized || containsSensitiveMemoryData(normalized)) return { answer: memoryError({ code: normalized ? 'MEMORY_SENSITIVE' : 'MEMORY_EMPTY' }), buttons: interactionCancel(interaction.id) };
      const consumed = await this.interactions.consume({ id: interaction.id, userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId });
      if (!consumed) return { answer: 'Этот запрос уже недоступен.' };
      const result = await this.memoryService.remember({ userId: context.user.id, content: normalized, sourceConversationId: context.conversation.id });
      if (!result.ok) return { answer: memoryError(result) };
      return { answer: 'Запомнил.', buttons: memoryMenu() };
    }

    if (interaction.kind === 'memory_correct_replacement') {
      const normalized = normalizeMemoryContent(value);
      if (!normalized || containsSensitiveMemoryData(normalized)) return { answer: memoryError({ code: normalized ? 'MEMORY_SENSITIVE' : 'MEMORY_EMPTY' }), buttons: interactionCancel(interaction.id) };
      const consumed = await this.interactions.consume({ id: interaction.id, userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId });
      if (!consumed) return { answer: 'Этот запрос уже недоступен.' };
      const result = await this.memoryService.correctById({ userId: context.user.id, memoryId: interaction.context.memoryId, content: normalized, sourceConversationId: context.conversation.id });
      if (!result.ok) return { answer: memoryError(result) };
      return { answer: 'Исправил и буду считать новый факт актуальным.', buttons: memoryMenu() };
    }

    if (interaction.kind === 'device_instruction') {
      if (value.startsWith('/')) return { answer: 'Опиши поручение обычными словами, без команды.', buttons: interactionCancel(interaction.id) };
      const consumed = await this.interactions.consume({ id: interaction.id, userId: context.user.id, conversationId: context.conversation.id, chatId: context.chatId });
      return consumed ? { desktopInstruction: { text: value, preferredDeviceId: interaction.context.deviceId } } : { answer: 'Этот запрос уже недоступен.' };
    }
    return null;
  }
}

module.exports = { TelegramMenuService, deviceMenu, interactionCancel, memoryMenu };
