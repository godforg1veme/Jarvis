const { createRemoteMessage } = require('../../devices/remoteProtocol');
const { sendTelegramText } = require('../../telegram/telegramFormatting');

class TelegramReminderTransport {
  constructor(options = {}) {
    this.bot = options.bot || null;
    this.conversationRepository = options.conversationRepository;
  }

  async deliver({ userId, conversationId, title, reminderId }) {
    if (!this.bot?.api || !conversationId) return { status: 'transient_failure', errorCode: 'TELEGRAM_UNAVAILABLE' };
    const conversation = await this.conversationRepository.getForUser({ userId, conversationId });
    if (!conversation || conversation.channel !== 'telegram') return { status: 'permanent_failure', errorCode: 'DESTINATION_UNAVAILABLE' };
    await sendTelegramText(
      (chunk, options) => this.bot.api.sendMessage(conversation.external_chat_id, chunk, options),
      `Напоминание: ${title}`,
      { reply_markup: { inline_keyboard: [[{ text: 'Готово', callback_data: `life:reminder:ack:${reminderId}` }]] } },
    );
    return { status: 'delivered' };
  }
}

class DesktopReminderTransport {
  constructor(options = {}) { this.sessionRegistry = options.sessionRegistry; }

  async deliver({ userId, deviceId, title, reminderId }) {
    const session = this.sessionRegistry?.get(deviceId);
    if (!session || session.userId !== userId) return { status: 'transient_failure', errorCode: 'DESKTOP_OFFLINE' };
    const sent = this.sessionRegistry.send(deviceId, createRemoteMessage('life.reminder', { reminderId, title }));
    return sent ? { status: 'delivered' } : { status: 'transient_failure', errorCode: 'DESKTOP_OFFLINE' };
  }
}

module.exports = { DesktopReminderTransport, TelegramReminderTransport };
