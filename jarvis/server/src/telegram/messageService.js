const MAX_TEXT_LENGTH = 10000;
const MAX_TELEGRAM_VOICE_BYTES = 5 * 1024 * 1024;
const MAX_TELEGRAM_VOICE_SECONDS = 120;
const TELEGRAM_VOICE_TYPES = new Set(['audio/ogg', 'audio/opus', 'application/ogg']);
const { attachmentReply, isDeviceAttachmentQuestion } = require('../devices/deviceReplies');
const { attachmentFromTelegramMessage } = require('../knowledge/fileTypes');
const { publicDocumentStatus, renderDocumentCitations } = require('../knowledge/knowledgeService');
const { parseRemoteCommand, remoteCommandReply } = require('../commands/commandText');
const { recordMessageEvent } = require('../life/lifeSourceEvents');

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

function normalizeVpnCallbackUpdate(update) {
  const query = update && update.callback_query;
  const telegramUserId = query && query.from && String(query.from.id || '');
  const chatId = query && query.message && query.message.chat && String(query.message.chat.id || '');
  const data = query && typeof query.data === 'string' ? query.data : '';
  const updateId = Number(update && update.update_id);
  if (!/^\d{1,20}$/.test(telegramUserId) || !/^-?\d{1,20}$/.test(chatId)) throw new Error('invalid Telegram callback identity');
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error('invalid Telegram update ID');
  if (!data.startsWith('vpn:') || Buffer.byteLength(data, 'utf8') > 64) throw new Error('invalid VPN callback');
  return {
    updateId,
    telegramUserId,
    chatId,
    data,
    displayName: [query.from.first_name, query.from.last_name].filter(Boolean).join(' ').trim().slice(0, 100) || `Telegram ${telegramUserId}`,
  };
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
  if (command === '/help') return 'Доступно: текстовые вопросы, загрузка файлов, /life, /life_confirm ID, /life_dismiss ID, /documents, /document_delete ID confirm, /devices, /pair Имя ПК, /revoke ID устройства, /desktop DEVICE_ID ACTION JSON, /confirm COMMAND_ID, /reject COMMAND_ID, /command COMMAND_ID, /memory. VPN управляется кнопками из /vpn; для нового доступа можно написать /vpn_issue Имя. Также можно писать «запомни», «забудь» и «исправь старое → новое».';
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
    this.lifeEventGateway = options.lifeEventGateway || null;
    this.lifeMissionControlService = options.lifeMissionControlService || null;
    this.lifeProposalService = options.lifeProposalService || null;
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

  async handleVpnCallback(update) {
    const input = normalizeVpnCallbackUpdate(update);
    if (!this.accessPolicy.isAllowed(input.telegramUserId)) return { status: 'forbidden' };
    if (!this.vpnService || typeof this.vpnService.handleCallback !== 'function') return { status: 'ignored' };
    const claimed = await this.updateRepository.claim(input.updateId, input.telegramUserId);
    if (!claimed) return { status: 'duplicate' };
    const user = await this.userRepository.findOrCreateTelegramUser({ telegramUserId: input.telegramUserId, displayName: input.displayName });
    const conversation = await this.conversationRepository.getOrCreate({ userId: user.id, channel: 'telegram', externalChatId: input.chatId });
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
    await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: result.answer });
    return {
      status: 'answered',
      answer: result.answer,
      ...(result.artifact ? { artifact: result.artifact } : {}),
      ...(result.buttons ? { buttons: result.buttons } : {}),
    };
  }

  async documentCommandReply({ text, user }) {
    if (!this.knowledgeService) return null;
    const { command, argument } = commandParts(text);
    if (command === '/documents') {
      const documents = await this.knowledgeService.list({ userId: user.id });
      if (documents.length === 0) return 'Личных документов пока нет. Отправь мне файл в Telegram.';
      return documents.map((document) => `${document.original_name}\n${publicDocumentStatus(document)} · ${document.category} · ${document.id}`).join('\n\n');
    }
    if (command === '/document_delete') {
      const [documentId = '', confirmation = ''] = argument.split(/\s+/, 2);
      if (!/^[a-f0-9-]{36}$/i.test(documentId)) return 'Укажи ID документа из /documents: /document_delete ID';
      if (confirmation.toLowerCase() !== 'confirm') return `Удаление необратимо. Подтверди: /document_delete ${documentId} confirm`;
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
      return devices.map((device) => `${device.name} — ${device.status}\nID: ${device.id}`).join('\n\n');
    }

    if (command === '/pair') {
      const deviceName = argument || 'Мой компьютер';
      const pairing = await this.deviceService.beginPairing({ userId: user.id, deviceName });
      return `Код для «${deviceName}»: ${pairing.code}\nОткройте Jarvis Desktop и введите его в течение 10 минут.`;
    }

    if (command === '/revoke') {
      if (!argument) return 'Укажите ID устройства: /revoke ID';
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
      const proposals = data.proposals.slice(0, 5).map((item) => `• ${item.title}\n  /life_confirm ${item.id}\n  /life_dismiss ${item.id}`).join('\n');
      return [mission, commitments ? `\nДоговорённости:\n${commitments}` : '', proposals ? `\nПредложения:\n${proposals}` : ''].join('').slice(0, MAX_TEXT_LENGTH);
    }
    if (!/^[a-f0-9-]{36}$/i.test(argument)) return `Укажите ID: ${command} ID`;
    const action = command === '/life_confirm' ? 'confirm' : 'dismiss';
    const proposal = await this.lifeProposalService[action]({
      userId: user.id, proposalId: argument, originChannel: 'telegram', originConversationId: conversation.id,
    });
    return proposal ? (action === 'confirm' ? 'Предложение подтверждено.' : 'Предложение отклонено.') : 'Предложение недоступно, истекло или относится к другому каналу.';
  }

  async handle(update, options = {}) {
    const input = normalizeTelegramMessage(update);
    if (!this.accessPolicy.isAllowed(input.telegramUserId)) {
      return { status: 'forbidden' };
    }
    if (input.ignored) return { status: 'ignored' };

    const claimed = await this.updateRepository.claim(input.updateId, input.telegramUserId);
    if (!claimed) return { status: 'duplicate' };

    const user = await this.userRepository.findOrCreateTelegramUser({
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
    });
    const conversation = await this.conversationRepository.getOrCreate({
      userId: user.id,
      channel: 'telegram',
      externalChatId: input.chatId,
    });

    let voiceTranscript = false;
    if (input.voice && this.asr) {
      if (typeof options.downloadVoice !== 'function') throw new Error('voice transcription is unavailable');
      validateTelegramVoice(input.voice);
      if (this.voiceLimiter) {
        this.voiceLimiter.check(`telegram-voice:${user.id}`, { limit: 3, windowMs: 60000 });
      }
      const audio = await options.downloadVoice(input.voice);
      const transcription = await this.asr.transcribe({
        audio,
        mimeType: input.voice.mediaType,
        languageHint: 'ru',
      });
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

    const lifeAnswer = await this.lifeCommandReply({ text: input.text, user, conversation });
    if (lifeAnswer) {
      await this.conversationRepository.appendMessage({ userId: user.id, conversationId: conversation.id, role: 'assistant', content: lifeAnswer });
      return { status: 'answered', answer: lifeAnswer };
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
        content: vpnResult.answer,
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
      await this.conversationRepository.appendMessage({
        userId: user.id,
        conversationId: conversation.id,
        role: 'assistant',
        content: remoteAnswer,
      });
      return { status: 'answered', answer: remoteAnswer };
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
      return { status: 'answered', answer };
    }

    const memoryResult = this.memoryService
      ? await this.memoryService.handleUserText({ userId: user.id, text: input.text, sourceConversationId: conversation.id })
      : { handled: false };

    const deviceAnswer = await this.deviceCommandReply({ text: input.text, user });
    const documentAnswer = await this.documentCommandReply({ text: input.text, user });
    const memories = this.memoryService ? await this.memoryService.memoriesForPrompt({ userId: user.id }) : [];
    const devices = this.deviceService ? await this.deviceService.list({ userId: user.id }) : [];
    const documentSources = this.knowledgeService ? await this.knowledgeService.searchForPrompt({ userId: user.id, query: input.text }) : [];
    const visualMemories = this.visualMemoryService ? await this.visualMemoryService.searchForPrompt({ userId: user.id, query: input.text }) : [];
    const answer = commandReply(input.text) || deviceAnswer || documentAnswer || memoryResult.answer || await this.assistant.answer({
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
  normalizeTelegramMessage,
  normalizeVpnCallbackUpdate,
  validateTelegramVoice,
  vpnPublicError,
  voiceFromTelegramMessage,
};
