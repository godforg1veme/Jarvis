const MAX_TEXT_LENGTH = 10000;
const MAX_TELEGRAM_VOICE_BYTES = 5 * 1024 * 1024;
const MAX_TELEGRAM_VOICE_SECONDS = 120;
const TELEGRAM_VOICE_TYPES = new Set(['audio/ogg', 'audio/opus', 'application/ogg']);
const { attachmentReply, isDeviceAttachmentQuestion } = require('../devices/deviceReplies');
const { attachmentFromTelegramMessage } = require('../knowledge/fileTypes');
const { publicDocumentStatus, renderDocumentCitations } = require('../knowledge/knowledgeService');
const { parseRemoteCommand, remoteCommandReply } = require('../commands/commandText');
const { recordMessageEvent } = require('../life/lifeSourceEvents');
const { menuAction } = require('./telegramMenu');
const { classifyTelegramFailure, telegramFailureReply } = require('./telegramFailure');

function telegramMenuContext({ user, conversation, input }) {
  return {
    user,
    userId: user.id,
    conversation,
    conversationId: conversation.id,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    originChannel: 'telegram',
    originDeviceId: null,
  };
}

function voiceFromTelegramMessage(message = {}) {
  const candidate = message.voice;
  if (!candidate || !candidate.file_id) return null;
  const mimeType = String(candidate.mime_type || 'audio/ogg').split(';', 1)[0].trim().toLowerCase();
  const durationSeconds = Number(candidate.duration);
  const byteSize = Number(candidate.file_size || 0);
  return Object.freeze({
    fileId: String(candidate.file_id).slice(0, 256),
    fileUniqueId: String(candidate.file_unique_id || '').slice(0, 256),
    mediaType: mimeType,
    byteSize: Number.isSafeInteger(byteSize) && byteSize >= 0 ? byteSize : null,
    durationSeconds: Number.isSafeInteger(durationSeconds) && durationSeconds >= 0 ? durationSeconds : null,
  });
}

function validateTelegramVoice(voice) {
  if (!voice || !voice.fileId || !TELEGRAM_VOICE_TYPES.has(voice.mediaType)) {
    throw new Error('invalid Telegram voice');
  }
  if (voice.byteSize === null || voice.byteSize > MAX_TELEGRAM_VOICE_BYTES) {
    throw new Error('Telegram voice is too large');
  }
  if (voice.durationSeconds === null || voice.durationSeconds < 1 || voice.durationSeconds > MAX_TELEGRAM_VOICE_SECONDS) {
    throw new Error('Telegram voice duration is invalid');
  }
}

function normalizeTelegramMessage(update) {
  const message = update && update.message;
  const telegramUserId = message && message.from && String(message.from.id || '');
  const chatId = message && message.chat && String(message.chat.id || '');
  const text = message && typeof message.text === 'string' ? message.text.trim() : '';
  const voice = voiceFromTelegramMessage(message || {});
  const attachment = attachmentFromTelegramMessage(message || {});
  const updateId = Number(update && update.update_id);

  if (!/^\d{1,20}$/.test(telegramUserId)) throw new Error('invalid Telegram user ID');
  if (!/^-?\d{1,20}$/.test(chatId)) throw new Error('invalid Telegram chat ID');
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error('invalid Telegram update ID');
  if (!text && !attachment && !voice) {
    return {
      updateId,
      telegramUserId,
      chatId,
      messageId: String(message.message_id),
      displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(' ').trim().slice(0, 100) || `Telegram ${telegramUserId}`,
      text: '',
      voice: null,
      attachment: null,
      ignored: true,
    };
  }
  if (text.length > MAX_TEXT_LENGTH) throw new Error('message text is too long');

  const displayName = [message.from.first_name, message.from.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
    .slice(0, 100) || `Telegram ${telegramUserId}`;

  return {
    updateId,
    telegramUserId,
    chatId,
    messageId: String(message.message_id),
    displayName,
    text,
    voice,
    attachment,
  };
}

function normalizeTelegramCallbackUpdate(update) {
  const query = update && update.callback_query;
  const telegramUserId = query && query.from && String(query.from.id || '');
  const chatId = query && query.message && query.message.chat && String(query.message.chat.id || '');
  const data = query && typeof query.data === 'string' ? query.data : '';
  const updateId = Number(update && update.update_id);
  if (!/^\d{1,20}$/.test(telegramUserId) || !/^-?\d{1,20}$/.test(chatId)) throw new Error('invalid Telegram callback identity');
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error('invalid Telegram update ID');
  if (Buffer.byteLength(data, 'utf8') > 64) throw new Error('invalid Telegram callback');
  return {
    updateId,
    telegramUserId,
    chatId,
    data,
    displayName: [query.from.first_name, query.from.last_name].filter(Boolean).join(' ').trim().slice(0, 100) || `Telegram ${telegramUserId}`,
  };
}

function normalizeVpnCallbackUpdate(update) {
  const normalized = normalizeTelegramCallbackUpdate(update);
  if (!normalized.data.startsWith('vpn:')) throw new Error('invalid VPN callback');
  return normalized;
}

function vpnPublicError(error) {
  if (!error || !error.publicCode) throw error;
  const unavailable = ['VPN_CONFIRMATION_UNAVAILABLE', 'VPN_CLIENT_NOT_FOUND'].includes(error.publicCode);
  return {
    status: 'answered',
    answer: unavailable ? 'Эта кнопка уже недоступна. Открой актуальное меню VPN.' : 'Не удалось выполнить VPN-действие. Открой меню и попробуй ещё раз.',
    buttons: [[{ text: '← В меню VPN', data: 'vpn:menu' }]],
  };
}

function commandReply(text) {
  const command = String(text || '').split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase();
  if (command === '/start') return 'Jarvis подключён. Напишите вопрос обычным сообщением.';
  if (command === '/help') return 'Пиши вопросы обычным текстом, отправляй голосовые и файлы или используй нижнее меню. Действия с последствиями подтверждаются отдельными кнопками под сообщением.';
  if (command === '/memory') return null;
  return null;
}

function commandParts(text) {
  const [rawCommand = '', ...rest] = String(text || '').trim().split(/\s+/);
  return {
    command: rawCommand.split('@', 1)[0].toLowerCase(),
    argument: rest.join(' ').trim(),
  };
}

class TelegramMessageService {
  constructor(options) {
    this.accessPolicy = options.accessPolicy;
    this.updateRepository = options.updateRepository;
    this.userRepository = options.userRepository;
    this.conversationRepository = options.conversationRepository;
    this.assistant = options.assistant;
    this.deviceService = options.deviceService || null;
    this.memoryService = options.memoryService || null;
    this.knowledgeService = options.knowledgeService || null;
    this.commandService = options.commandService || null;
    this.orchestrator = options.orchestrator || null;
    this.visualMemoryService = options.visualMemoryService || null;
    this.asr = options.asr || null;
    this.voiceLimiter = options.voiceLimiter || null;
    this.vpnService = options.vpnService || null;
    this.vpnSupervisorService = options.vpnSupervisorService || null;
    this.lifeEventGateway = options.lifeEventGateway || null;
    this.lifeMissionControlService = options.lifeMissionControlService || null;
    this.lifeProposalService = options.lifeProposalService || null;
    this.lifeReminderService = options.lifeReminderService || null;
    this.menuService = options.menuService || null;
    this.logger = options.logger || null;
  }

  async markCompleted(updateId) {
    if (typeof this.updateRepository?.markCompleted !== 'function') return;
    await this.updateRepository.markCompleted(updateId);
  }

  async failureResult({ updateId, error, phase }) {
    const failureCode = classifyTelegramFailure(error);
    try {
      if (typeof this.updateRepository?.markFailed === 'function') {
        await this.updateRepository.markFailed(updateId, failureCode);
      }
    } catch (_) {
      // A diagnostic write must never hide the safe reply for the Telegram user.
    }
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn({ telegramFailureCode: failureCode, telegramFailurePhase: phase, updateId }, 'Telegram update recovered with fallback reply');
    }
    return { status: 'answered', answer: telegramFailureReply(failureCode) };
  }

  async remoteCommandReply({ text, user, conversationId }) {
    return remoteCommandReply({
      text,
      userId: user.id,
      conversationId,
      originChannel: 'telegram',
      commandService: this.commandService,
      orchestrator: this.orchestrator,
    });
  }

  async handleCallback(update) {
    const input = normalizeTelegramCallbackUpdate(update);
    if (!this.accessPolicy.isAllowed(input.telegramUserId)) return { status: 'forbidden' };
    const claimed = await this.updateRepository.claim(input.updateId, input.telegramUserId, 'callback');
    if (!claimed) return { status: 'duplicate' };
    try {
      const result = await this.handleClaimedCallback(input);
      await this.markCompleted(input.updateId);
      return result;
    } catch (error) {
      return this.failureResult({ updateId: input.updateId, error, phase: 'callback' });
    }
  }

  async handleClaimedCallback(input) {
    const user = await this.userRepository.findOrCreateTelegramUser({ telegramUserId: input.telegramUserId, displayName: input.displayName });
    const conversation = await this.conversationRepository.getOrCreate({ userId: user.id, channel: 'telegram', externalChatId: input.chatId });
    const menuContext = telegramMenuContext({ user, conversation, input });

    if (input.data.startsWith('vpsup:')) {
      if (!this.vpnSupervisorService) return { status: 'ignored' };
      const result = await this.vpnSupervisorService.handleCallback({
        data: input.data,
        telegramUserId: input.telegramUserId,
      });
      if (!result) return { status: 'ignored' };
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: result.answer });
      return { status: 'answered', ...result };
    }

    if (this.menuService) {
      let menuResult;
      try {
        menuResult = await this.menuService.handleCallback(input.data, { ...menuContext, data: input.data });
      } catch (error) {
        menuResult = input.data.startsWith('vpn:') ? vpnPublicError(error) : null;
        if (!menuResult) throw error;
      }
      if (menuResult) {
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: menuResult.historyAnswer || menuResult.answer });
        return { status: 'answered', ...menuResult };
      }
    }

    if (input.data.startsWith('vpn:')) {
      if (!this.vpnService || typeof this.vpnService.handleCallback !== 'function') return { status: 'ignored' };
      let result;
      try {
        result = await this.vpnService.handleCallback({
          data: input.data,
          userId: user.id,
          conversationId: conversation.id,
          originChannel: 'telegram',
          originDeviceId: null,
        });
      } catch (error) {
        result = vpnPublicError(error);
      }
      if (!result) return { status: 'ignored' };
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: result.historyAnswer || result.answer });
      return {
        status: 'answered',
        answer: result.answer,
        ...(result.artifact ? { artifact: result.artifact } : {}),
        ...(result.buttons ? { buttons: result.buttons } : {}),
      };
    }

    const cmdMatch = /^cmd:(confirm|reject):([a-f0-9-]{36})$/i.exec(input.data);
    if (cmdMatch) {
      const decision = cmdMatch[1].toLowerCase();
      const commandId = cmdMatch[2];
      try {
        let answer = '';
        if (this.orchestrator) {
          const wfResult = decision === 'confirm'
            ? await this.orchestrator.confirm({ userId: user.id, conversationId: conversation.id, originChannel: 'telegram', originDeviceId: null, commandId, text: decision })
            : await this.orchestrator.reject({ userId: user.id, conversationId: conversation.id, originChannel: 'telegram', originDeviceId: null, commandId, text: decision });
          if (wfResult && wfResult.handled) answer = wfResult.answer;
        }
        if (!answer && this.commandService) {
          const res = decision === 'confirm'
            ? await this.commandService.approve({ userId: user.id, commandId, originChannel: 'telegram', originDeviceId: null })
            : await this.commandService.reject({ userId: user.id, commandId, originChannel: 'telegram', originDeviceId: null });
          if (res.status === 'running') answer = 'Подтверждение принято. Действие выполняется на компьютере.';
          else if (res.status === 'failed') answer = `Команда не выполнена: ${res.error || 'ошибка доставки'}.`;
          else answer = 'Действие отменено.';
        }
        if (!answer) answer = decision === 'confirm' ? 'Подтверждение принято.' : 'Действие отменено.';
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
        return { status: 'answered', answer };
      } catch (error) {
        const errorAnswer = error.publicCode === 'CONFIRMATION_UNAVAILABLE'
          ? 'Подтверждение не найдено, уже использовано или истекло.'
          : 'Не удалось обработать подтверждение.';
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: errorAnswer });
        return { status: 'answered', answer: errorAnswer };
      }
    }

    const lifeMatch = /^life:(confirm|dismiss):([a-f0-9-]{36})$/i.exec(input.data);
    if (lifeMatch) {
      if (!this.lifeProposalService) return { status: 'ignored' };
      const action = lifeMatch[1].toLowerCase();
      const proposalId = lifeMatch[2];
      const proposal = await this.lifeProposalService[action]({
        userId: user.id, proposalId, originChannel: 'telegram', originConversationId: conversation.id,
      });
      const answer = proposal ? (action === 'confirm' ? 'Предложение подтверждено.' : 'Предложение отклонено.') : 'Предложение недоступно, истекло или относится к другому каналу.';
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
      return { status: 'answered', answer };
    }

    const reminderMatch = /^life:reminder:ack:([a-f0-9-]{36})$/i.exec(input.data);
    if (reminderMatch) {
      if (!this.lifeReminderService) return { status: 'ignored' };
      const reminder = await this.lifeReminderService.acknowledgeLatest({
        userId: user.id, reminderId: reminderMatch[1], originConversationId: conversation.id,
      });
      const answer = reminder ? 'Напоминание отмечено выполненным.' : 'Это напоминание уже недоступно.';
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
      return { status: 'answered', answer };
    }

    const docMatch = /^doc:(del_prompt|delete|cancel)(?::([a-f0-9-]{36}))?$/i.exec(input.data);
    if (docMatch) {
      if (!this.knowledgeService) return { status: 'ignored' };
      const subAction = docMatch[1].toLowerCase();
      const documentId = docMatch[2];
      if (subAction === 'cancel') {
        const answer = 'Удаление документа отменено.';
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
        return { status: 'answered', answer };
      }
      if (subAction === 'del_prompt' && documentId) {
        const docs = await this.knowledgeService.list({ userId: user.id });
        const doc = docs.find((d) => d.id === documentId);
        const name = doc ? `«${doc.original_name}»` : 'выбранный документ';
        const answer = `Удалить документ ${name}? Удаление необратимо.`;
        const buttons = [
          [
            { text: '🗑 Да, удалить', data: `doc:delete:${documentId}` },
            { text: 'Отмена', data: 'doc:cancel' },
          ],
        ];
        return { status: 'answered', answer, buttons };
      }
      if (subAction === 'delete' && documentId) {
        const deleted = await this.knowledgeService.remove({ userId: user.id, documentId });
        const answer = deleted ? `Документ «${deleted.original_name}» удалён.` : 'Документ не найден.';
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
        return { status: 'answered', answer };
      }
    }

    const devMatch = /^dev:(revoke_prompt|revoke|cancel)(?::([a-f0-9-]{36}))?$/i.exec(input.data);
    if (devMatch) {
      if (!this.deviceService) return { status: 'ignored' };
      const subAction = devMatch[1].toLowerCase();
      const deviceId = devMatch[2];
      if (subAction === 'cancel') {
        const answer = 'Отзыв устройства отменён.';
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
        return { status: 'answered', answer };
      }
      if (subAction === 'revoke_prompt' && deviceId) {
        const devices = await this.deviceService.list({ userId: user.id });
        const dev = devices.find((d) => d.id === deviceId);
        const name = dev ? `«${dev.name}»` : 'выбранное устройство';
        const answer = `Отозвать доступ для устройства ${name}?`;
        const buttons = [
          [
            { text: '⛔ Да, отозвать', data: `dev:revoke:${deviceId}` },
            { text: 'Отмена', data: 'dev:cancel' },
          ],
        ];
        return { status: 'answered', answer, buttons };
      }
      if (subAction === 'revoke' && deviceId) {
        const revoked = await this.deviceService.revoke({ userId: user.id, deviceId });
        const answer = revoked ? `Устройство «${revoked.name}» отозвано.` : 'Устройство не найдено или уже отозвано.';
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
        return { status: 'answered', answer };
      }
    }

    return { status: 'ignored' };
  }

  async handleVpnCallback(update) {
    return this.handleCallback(update);
  }

  async documentCommandReply({ text, user }) {
    if (!this.knowledgeService) return null;
    const { command, argument } = commandParts(text);
    if (command === '/documents') {
      const documents = await this.knowledgeService.list({ userId: user.id });
      if (documents.length === 0) return 'Личных документов пока нет. Отправь мне файл в Telegram.';
      const listText = documents.map((document) => `${document.original_name}\n${publicDocumentStatus(document)} · ${document.category}`).join('\n\n');
      const buttons = documents.slice(0, 8).map((document) => [
        { text: `🗑 Удалить «${document.original_name.slice(0, 30)}»`, data: `doc:del_prompt:${document.id}` },
      ]);
      return { answer: listText, buttons: buttons.length ? buttons : undefined };
    }
    if (command === '/document_delete') {
      const [documentId = '', confirmation = ''] = argument.split(/\s+/, 2);
      if (!documentId) {
        const documents = await this.knowledgeService.list({ userId: user.id });
        if (documents.length === 0) return 'Личных документов пока нет.';
        const buttons = documents.slice(0, 8).map((doc) => [
          { text: `🗑 ${doc.original_name.slice(0, 30)}`, data: `doc:del_prompt:${doc.id}` },
        ]);
        return { answer: 'Выбери документ для удаления:', buttons };
      }
      if (!/^[a-f0-9-]{36}$/i.test(documentId)) return 'Укажи ID документа из /documents или выбери в списке.';
      if (confirmation.toLowerCase() !== 'confirm') {
        return {
          answer: 'Удаление необратимо. Подтвердить удаление документа?',
          buttons: [
            [{ text: '🗑 Да, удалить', data: `doc:delete:${documentId}` }, { text: 'Отмена', data: 'doc:cancel' }],
          ],
        };
      }
      const deleted = await this.knowledgeService.remove({ userId: user.id, documentId });
      return deleted ? `Документ «${deleted.original_name}» удалён.` : 'Документ не найден.';
    }
    return null;
  }

  async deviceCommandReply({ text, user }) {
    const { command, argument } = commandParts(text);
    const attachmentQuestion = isDeviceAttachmentQuestion(text);
    if (!this.deviceService) return command === '/devices' ? 'Устройства пока не подключены.' : null;

    if (command === '/devices' || attachmentQuestion) {
      const devices = await this.deviceService.list({ userId: user.id });
      if (attachmentQuestion) return attachmentReply(devices);
      if (devices.length === 0) return 'Подключённых устройств пока нет. Используйте /pair Имя ПК.';
      const listText = devices.map((device) => `${device.name} — ${device.status}`).join('\n\n');
      const activeDevices = devices.filter((d) => d.status !== 'revoked');
      const buttons = activeDevices.slice(0, 8).map((device) => [
        { text: `⛔ Отозвать «${device.name.slice(0, 25)}»`, data: `dev:revoke_prompt:${device.id}` },
      ]);
      return { answer: listText, buttons: buttons.length ? buttons : undefined };
    }

    if (command === '/pair') {
      const deviceName = argument || 'Мой компьютер';
      const pairing = await this.deviceService.beginPairing({ userId: user.id, deviceName });
      return `Код для «${deviceName}»: ${pairing.code}\nОткройте Jarvis Desktop и введите его в течение 10 минут.`;
    }

    if (command === '/revoke') {
      if (!argument) {
        const devices = await this.deviceService.list({ userId: user.id });
        const activeDevices = devices.filter((d) => d.status !== 'revoked');
        if (activeDevices.length === 0) return 'Нет активных подключённых устройств.';
        const buttons = activeDevices.slice(0, 8).map((d) => [
          { text: `⛔ ${d.name.slice(0, 25)}`, data: `dev:revoke_prompt:${d.id}` },
        ]);
        return { answer: 'Выбери устройство для отзыва доступа:', buttons };
      }
      const revoked = await this.deviceService.revoke({ userId: user.id, deviceId: argument });
      return revoked ? `Устройство «${revoked.name}» отозвано.` : 'Устройство не найдено или уже отозвано.';
    }
    return null;
  }

  async lifeCommandReply({ text, user, conversation }) {
    const { command, argument } = commandParts(text);
    if (!['/life', '/life_confirm', '/life_dismiss'].includes(command)) return null;
    if (!this.lifeMissionControlService || !this.lifeProposalService) return 'Life OS пока не включён.';
    if (command === '/life') {
      const data = await this.lifeMissionControlService.get({ userId: user.id });
      const mission = data.currentMission ? `Текущая миссия: ${data.currentMission.name}` : 'Текущая миссия не выбрана.';
      const commitments = data.commitments.slice(0, 5).map((item) => `• ${item.title}${item.dueAt ? ` — ${new Date(item.dueAt).toLocaleString('ru-RU')}` : ''}`).join('\n');
      const proposalsText = data.proposals.slice(0, 5).map((item) => `• ${item.title}`).join('\n');
      const answer = [mission, commitments ? `\nДоговорённости:\n${commitments}` : '', proposalsText ? `\nПредложения:\n${proposalsText}` : ''].join('').slice(0, MAX_TEXT_LENGTH);
      const buttons = data.proposals.slice(0, 5).map((item) => [
        { text: `✅ Принять «${item.title.slice(0, 20)}»`, data: `life:confirm:${item.id}` },
        { text: '❌', data: `life:dismiss:${item.id}` },
      ]);
      return { answer, buttons: buttons.length ? buttons : undefined };
    }

    let proposalId = argument;
    if (!proposalId) {
      const data = await this.lifeMissionControlService.get({ userId: user.id });
      const first = data.proposals?.[0];
      if (!first) return 'Нет предложений, ожидающих подтверждения.';
      proposalId = first.id;
    }
    if (!/^[a-f0-9-]{36}$/i.test(proposalId)) return `Укажите ID или используйте кнопки в /life`;
    const action = command === '/life_confirm' ? 'confirm' : 'dismiss';
    const proposal = await this.lifeProposalService[action]({
      userId: user.id, proposalId, originChannel: 'telegram', originConversationId: conversation.id,
    });
    return proposal ? (action === 'confirm' ? 'Предложение подтверждено.' : 'Предложение отклонено.') : 'Предложение недоступно, истекло или относится к другому каналу.';
  }

  async handle(update, options = {}) {
    const input = normalizeTelegramMessage(update);
    if (!this.accessPolicy.isAllowed(input.telegramUserId)) {
      return { status: 'forbidden' };
    }
    if (input.ignored) return { status: 'ignored' };

    const claimed = await this.updateRepository.claim(input.updateId, input.telegramUserId, 'message');
    if (!claimed) return { status: 'duplicate' };

    try {
      const result = await this.handleClaimedMessage(input, options);
      await this.markCompleted(input.updateId);
      return result;
    } catch (error) {
      return this.failureResult({ updateId: input.updateId, error, phase: 'message' });
    }
  }

  async handleClaimedMessage(input, options = {}) {
    const user = await this.userRepository.findOrCreateTelegramUser({
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
    });
    const conversation = await this.conversationRepository.getOrCreate({
      userId: user.id,
      channel: 'telegram',
      externalChatId: input.chatId,
    });
    const menuContext = telegramMenuContext({ user, conversation, input });

    let guidedDesktopInstruction = null;
    if (this.menuService && !input.attachment && !input.voice) {
      const legacyNavigation = /^\/start(?:@\w+)?$/i.test(input.text)
        ? 'home'
        : /^\/help(?:@\w+)?$/i.test(input.text) ? 'help' : null;
      const action = menuAction(input.text) || legacyNavigation;
      if (action) {
        const menuResult = await this.menuService.handleMenuAction(action, menuContext);
        const answer = String(menuResult?.answer || '').trim();
        if (!answer) throw new Error('Telegram menu returned an empty answer');
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
        return { status: 'answered', ...menuResult, answer };
      }
      const pendingResult = await this.menuService.handlePendingText(input.text, menuContext);
      if (pendingResult?.desktopInstruction) {
        guidedDesktopInstruction = pendingResult.desktopInstruction;
        input.text = guidedDesktopInstruction.text;
      } else if (pendingResult) {
        const answer = String(pendingResult.answer || '').trim();
        if (!answer) throw new Error('Telegram interaction returned an empty answer');
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answer });
        return { status: 'answered', ...pendingResult, answer };
      }
    }

    let voiceTranscript = false;
    if (input.voice && this.asr) {
      if (typeof options.downloadVoice !== 'function') throw new Error('voice transcription is unavailable');
      validateTelegramVoice(input.voice);
      if (this.voiceLimiter) {
        this.voiceLimiter.check(`telegram-voice:${user.id}`, { limit: 3, windowMs: 60000 });
      }
      const audio = await options.downloadVoice(input.voice);
      let transcription;
      try {
        transcription = await this.asr.transcribe({
          audio,
          mimeType: input.voice.mediaType,
          languageHint: 'ru',
        });
      } catch (_) {
        const error = new Error('Telegram voice transcription failed');
        error.name = 'TelegramVoiceTranscriptionError';
        throw error;
      }
      const transcript = String(transcription && transcription.text || '').trim();
      if (!transcript || transcript.length > MAX_TEXT_LENGTH) throw new Error('invalid Telegram voice transcription');
      input.text = transcript;
      voiceTranscript = true;
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'user',
        contentType: 'voice_transcript',
        content: input.text,
        externalMessageId: input.messageId,
      });
    } else if (input.attachment) {
      if (!this.knowledgeService || typeof options.downloadAttachment !== 'function') {
        throw new Error('document ingestion is unavailable');
      }
      const data = await options.downloadAttachment(input.attachment);
      let document;
      try {
        document = await this.knowledgeService.ingest({ userId: user.id, attachment: input.attachment, data });
      } catch (error) {
        if (error && error.code === 'KNOWLEDGE_WRITES_PAUSED') {
          return { status: 'answered', answer: 'Загрузка документов временно приостановлена на время резервного копирования. Попробуй ещё раз через несколько минут.' };
        }
        throw error;
      }
      const answer = `Принял «${document.originalName || document.name}». Индексирую; статус появится в /documents.`;
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'user',
        contentType: 'document',
        content: `Документ: ${document.originalName || document.name}`,
        externalMessageId: input.messageId,
      });
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
      });
      return { status: 'answered', answer };
    }

    if (!voiceTranscript) {
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'user',
        content: input.text,
        externalMessageId: input.messageId,
      });
    }

    await recordMessageEvent(this.lifeEventGateway, {
      userId: user.id,
      conversationId: conversation.id,
      sourceChannel: 'telegram',
      sourceRef: `telegram:${input.updateId}`,
      deduplicationKey: `telegram-message:${user.id}:${input.updateId}`,
      externalMessageId: input.messageId,
      kind: voiceTranscript ? 'voice' : 'text',
      text: input.text,
    });

    if (this.vpnSupervisorService) {
      const supervisorResult = await this.vpnSupervisorService.handleCommand({
        text: input.text,
        telegramUserId: input.telegramUserId,
      });
      if (supervisorResult) {
        await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: supervisorResult.answer });
        return { status: 'answered', ...supervisorResult };
      }
    }

    const lifeAnswer = await this.lifeCommandReply({ text: input.text, user, conversation });
    if (lifeAnswer) {
      const answerText = typeof lifeAnswer === 'string' ? lifeAnswer : lifeAnswer.answer;
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answerText });
      return { status: 'answered', answer: answerText, ...(lifeAnswer.buttons ? { buttons: lifeAnswer.buttons } : {}) };
    }

    let vpnResult = null;
    if (this.vpnService) {
      try {
        vpnResult = await this.vpnService.handle({
          text: input.text, userId: user.id, conversationId: conversation.id,
          originChannel: 'telegram', originDeviceId: null,
        });
      } catch (error) {
        vpnResult = vpnPublicError(error);
      }
    }
    if (vpnResult) {
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'assistant',
        content: vpnResult.historyAnswer || vpnResult.answer,
      });
      return {
        status: 'answered',
        answer: vpnResult.answer,
        ...(vpnResult.artifact ? { artifact: vpnResult.artifact } : {}),
        ...(vpnResult.buttons ? { buttons: vpnResult.buttons } : {}),
      };
    }

    const remoteAnswer = await this.remoteCommandReply({ text: input.text, user, conversationId: conversation.id });
    if (remoteAnswer) {
      const answerText = typeof remoteAnswer === 'string' ? remoteAnswer : remoteAnswer.answer;
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'assistant',
        content: answerText,
      });
      return { status: 'answered', answer: answerText, ...(remoteAnswer.buttons ? { buttons: remoteAnswer.buttons } : {}) };
    }

    const history = await this.conversationRepository.recentMessages({
      userId: user.id,
      conversationId: conversation.id,
      limit: 30,
    });
    const orchestration = this.orchestrator ? await this.orchestrator.handle({
      userId: user.id,
      conversationId: conversation.id,
      originChannel: 'telegram',
      originChatId: input.chatId,
      text: input.text,
      history,
      ...(guidedDesktopInstruction ? { preferredDeviceId: guidedDesktopInstruction.preferredDeviceId } : {}),
    }) : { handled: false };
    if (orchestration.handled) {
      const answer = String(orchestration.answer || '').trim().slice(0, MAX_TEXT_LENGTH);
      if (!answer) throw new Error('orchestrator returned an empty answer');
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
      });
      return { status: 'answered', answer, ...(orchestration.buttons ? { buttons: orchestration.buttons } : {}) };
    }

    const memoryResult = this.memoryService
      ? await this.memoryService.handleUserText({ userId: user.id, text: input.text, sourceConversationId: conversation.id })
      : { handled: false };

    const deviceAnswer = await this.deviceCommandReply({ text: input.text, user });
    if (deviceAnswer) {
      const answerText = typeof deviceAnswer === 'string' ? deviceAnswer : deviceAnswer.answer;
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answerText });
      return { status: 'answered', answer: answerText, ...(deviceAnswer.buttons ? { buttons: deviceAnswer.buttons } : {}) };
    }

    const documentAnswer = await this.documentCommandReply({ text: input.text, user });
    if (documentAnswer) {
      const answerText = typeof documentAnswer === 'string' ? documentAnswer : documentAnswer.answer;
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: answerText });
      return { status: 'answered', answer: answerText, ...(documentAnswer.buttons ? { buttons: documentAnswer.buttons } : {}) };
    }

    const memories = this.memoryService ? await this.memoryService.memoriesForPrompt({ userId: user.id }) : [];
    const devices = this.deviceService ? await this.deviceService.list({ userId: user.id }) : [];
    const documentSources = this.knowledgeService ? await this.knowledgeService.searchForPrompt({ userId: user.id, query: input.text }) : [];
    const visualMemories = this.visualMemoryService ? await this.visualMemoryService.searchForPrompt({ userId: user.id, query: input.text }) : [];
    const answer = commandReply(input.text) || memoryResult.answer || await this.assistant.answer({
      userId: user.id,
      conversationId: conversation.id,
      currentRequest: input.text,
      history,
      memories,
      documents: documentSources,
      visualMemories,
      devices,
      runtimeContext: {
        channel: 'telegram',
        toolsAvailable: [],
        verifiedToolResults: [],
      },
    });
    const safeAnswer = renderDocumentCitations(String(answer || '').trim(), documentSources).slice(0, 10000);
    if (!safeAnswer) throw new Error('provider returned an empty answer');

    await this.conversationRepository.appendMessage({
      userId: user.id,
      conversationId: conversation.id,
      role: 'assistant',
      content: safeAnswer,
    });

    return { status: 'answered', answer: safeAnswer };
  }
}

module.exports = {
  MAX_TEXT_LENGTH,
  MAX_TELEGRAM_VOICE_BYTES,
  MAX_TELEGRAM_VOICE_SECONDS,
  TelegramMessageService,
  commandReply,
  commandParts,
  parseRemoteCommand,
  normalizeTelegramCallbackUpdate,
  normalizeTelegramMessage,
  normalizeVpnCallbackUpdate,
  validateTelegramVoice,
  vpnPublicError,
  voiceFromTelegramMessage,
  telegramMenuContext,
};
