const MAX_TEXT_LENGTH = 10000;
const { attachmentReply, isDeviceAttachmentQuestion } = require('../devices/deviceReplies');
const { attachmentFromTelegramMessage } = require('../knowledge/fileTypes');
const { publicDocumentStatus, renderDocumentCitations } = require('../knowledge/knowledgeService');
const { parseRemoteCommand, remoteCommandReply } = require('../commands/commandText');

function normalizeTelegramMessage(update) {
  const message = update && update.message;
  const telegramUserId = message && message.from && String(message.from.id || '');
  const chatId = message && message.chat && String(message.chat.id || '');
  const text = message && typeof message.text === 'string' ? message.text.trim() : '';
  const attachment = attachmentFromTelegramMessage(message || {});
  const updateId = Number(update && update.update_id);

  if (!/^\d{1,20}$/.test(telegramUserId)) throw new Error('invalid Telegram user ID');
  if (!/^-?\d{1,20}$/.test(chatId)) throw new Error('invalid Telegram chat ID');
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error('invalid Telegram update ID');
  if (!text && !attachment) {
    return {
      updateId,
      telegramUserId,
      chatId,
      messageId: String(message.message_id),
      displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(' ').trim().slice(0, 100) || `Telegram ${telegramUserId}`,
      text: '',
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
    attachment,
  };
}

function commandReply(text) {
  const command = String(text || '').split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase();
  if (command === '/start') return 'Jarvis подключён. Напишите вопрос обычным сообщением.';
  if (command === '/help') return 'Доступно: текстовые вопросы, загрузка файлов, /documents, /document_delete ID confirm, /devices, /pair Имя ПК, /revoke ID устройства, /desktop DEVICE_ID ACTION JSON, /confirm COMMAND_ID, /reject COMMAND_ID, /command COMMAND_ID, /memory, а также «запомни», «забудь» и «исправь старое → новое».';
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

    if (input.attachment) {
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

    await this.conversationRepository.appendMessage({
      userId: user.id,
      conversationId: conversation.id,
      role: 'user',
      content: input.text,
      externalMessageId: input.messageId,
    });

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
  TelegramMessageService,
  commandReply,
  commandParts,
  parseRemoteCommand,
  normalizeTelegramMessage,
};
