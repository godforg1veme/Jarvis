const MAX_TEXT_LENGTH = 10000;

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
  if (command === '/help') return 'Доступно сейчас: текстовые вопросы. /devices и /memory появятся на следующих этапах.';
  if (command === '/devices') return 'Устройства пока не подключены.';
  if (command === '/memory') return 'Долговременная память пока не подключена.';
  return null;
}

class TelegramMessageService {
  constructor(options) {
    this.accessPolicy = options.accessPolicy;
    this.updateRepository = options.updateRepository;
    this.userRepository = options.userRepository;
    this.conversationRepository = options.conversationRepository;
    this.assistant = options.assistant;
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

    const history = await this.conversationRepository.recentMessages({
      userId: user.id,
      conversationId: conversation.id,
      limit: 30,
    });
    const answer = commandReply(input.text) || await this.assistant.answer({
      userId: user.id,
      conversationId: conversation.id,
      currentRequest: input.text,
      history,
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
  normalizeTelegramMessage,
};
