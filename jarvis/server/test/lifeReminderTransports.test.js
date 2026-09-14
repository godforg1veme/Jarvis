const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopReminderTransport, TelegramReminderTransport } = require('../src/life/reminders/reminderTransports');

test('Telegram reminder resolves the stored owner-scoped conversation before sending', async () => {
  const calls = [];
  const transport = new TelegramReminderTransport({
    conversationRepository: { async getForUser(input) { calls.push(input); return { channel: 'telegram', external_chat_id: 'safe-chat' }; } },
    bot: { api: { async sendMessage(chatId, text, options) { calls.push({ chatId, text, options }); } } },
  });
  const result = await transport.deliver({ userId: 'owner-a', conversationId: 'conversation-a', title: '<Life OS>', reminderId: 'reminder-a' });
  assert.equal(result.status, 'delivered');
  assert.deepEqual(calls[0], { userId: 'owner-a', conversationId: 'conversation-a' });
  assert.equal(calls[1].chatId, 'safe-chat');
  assert.match(calls[1].text, /&lt;Life OS&gt;/);
  assert.equal(calls[1].options.reply_markup.inline_keyboard[0][0].callback_data, 'life:reminder:ack:reminder-a');
});

test('Telegram and Desktop reject unavailable or cross-owner destinations without sending', async () => {
  let sent = 0;
  const telegram = new TelegramReminderTransport({
    conversationRepository: { async getForUser() { return null; } },
    bot: { api: { async sendMessage() { sent += 1; } } },
  });
  assert.equal((await telegram.deliver({ userId: 'owner-a', conversationId: 'missing', title: 'x', reminderId: 'r' })).status, 'permanent_failure');
  const desktop = new DesktopReminderTransport({ sessionRegistry: {
    get() { return { userId: 'owner-b' }; }, send() { sent += 1; return true; },
  } });
  assert.equal((await desktop.deliver({ userId: 'owner-a', deviceId: 'device-b', title: 'x', reminderId: 'r' })).status, 'transient_failure');
  assert.equal(sent, 0);
});

test('Desktop reminder uses the closed remote protocol payload', async () => {
  let message;
  const desktop = new DesktopReminderTransport({ sessionRegistry: {
    get() { return { userId: 'owner-a' }; }, send(_id, value) { message = value; return true; },
  } });
  assert.equal((await desktop.deliver({ userId: 'owner-a', deviceId: 'device-a', title: 'Продолжить Life OS', reminderId: 'reminder-a' })).status, 'delivered');
  assert.equal(message.type, 'life.reminder');
  assert.deepEqual(message.payload, { reminderId: 'reminder-a', title: 'Продолжить Life OS' });
});
