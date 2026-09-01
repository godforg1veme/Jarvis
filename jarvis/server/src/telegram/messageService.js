const MAX_TEXT_LENGTH = 10000;
const { attachmentReply, isDeviceAttachmentQuestion } = require('../devices/deviceReplies');

function normalizeTelegramMessage(update) {
  const message = update && update.message;
  const telegramUserId = message && message.from && String(message.from.id || '');
  const chatId = message && message.chat && String(message.chat.id || '');
  const text = message && typeof message.text === 'string' ? message.text.trim() : '';
  const updateId = Number(update && update.update_id);

  if (!/^\d{1,20}$/.test(telegramUserId)) throw new Error('invalid Telegram user ID');
  if (!/^-?\d{1,20}$/.test(chatId)) throw new Error('invalid Telegram chat ID');
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error('invalid Telegram update ID');
  if (!text) throw new Error('message text is required');
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
  };
}

function commandReply(text) {
  const command = text.split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase();
  if (command === '/start') return 'Jarvis подключён. Напишите вопрос обычным сообщением.';
  if (command === '/help') return 'Доступно: текстовые вопросы, /devices, /pair Имя ПК, /revoke ID устройства, /memory, а также «запомни», «забудь» и «исправь старое → новое».';
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

  async handle(update) {
    const input = normalizeTelegramMessage(update);
    if (!this.accessPolicy.isAllowed(input.telegramUserId)) {
      return { status: 'forbidden' };
    }

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

    await this.conversationRepository.appendMessage({
      userId: user.id,
      conversationId: conversation.id,
      role: 'user',
      content: input.text,
      externalMessageId: input.messageId,
    });

    const memoryResult = this.memoryService
      ? await this.memoryService.handleUserText({ userId: user.id, text: input.text, sourceConversationId: conversation.id })
      : { handled: false };

    const history = await this.conversationRepository.recentMessages({
      userId: user.id,
      conversationId: conversation.id,
      limit: 30,
    });
    const deviceAnswer = await this.deviceCommandReply({ text: input.text, user });
    const memories = this.memoryService ? await this.memoryService.memoriesForPrompt({ userId: user.id }) : [];
    const devices = this.deviceService ? await this.deviceService.list({ userId: user.id }) : [];
    const answer = commandReply(input.text) || deviceAnswer || memoryResult.answer || await this.assistant.answer({
      userId: user.id,
      conversationId: conversation.id,
      currentRequest: input.text,
      history,
      memories,
      devices,
      runtimeContext: {
        channel: 'telegram',
        toolsAvailable: [],
        verifiedToolResults: [],
      },
    });
    const safeAnswer = String(answer || '').trim().slice(0, 10000);
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
  normalizeTelegramMessage,
};
