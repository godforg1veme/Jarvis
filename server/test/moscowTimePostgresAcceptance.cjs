const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { runMigrations } = require('../src/db/migrate');
const { UserRepository } = require('../src/users/userRepository');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const { TelegramLifeOsService } = require('../src/telegram/telegramLifeOsService');
const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');
const { ReminderRepository } = require('../src/life/reminders/reminderRepository');
const { ReminderService } = require('../src/life/reminders/reminderService');

test('real Telegram reminder flows use Moscow time, keep invalid retry and reject foreign/repeated consumption', {
  skip: !process.env.JARVIS_MOSCOW_TEST_DATABASE_URL,
}, async () => {
  const admin = new Pool({ connectionString: process.env.JARVIS_MOSCOW_TEST_DATABASE_URL });
  const schema = `moscow_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.JARVIS_MOSCOW_TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  try {
    await runMigrations(pool);
    const users = new UserRepository(pool), conversations = new ConversationRepository(pool);
    const interactions = new TelegramInteractionRepository(pool);
    const reminders = new ReminderRepository(pool);
    const life = new TelegramLifeOsService({ interactions, reminderRepository: reminders, reminderService: new ReminderService({ repository: reminders }) });
    const menu = new TelegramMenuService({ interactions, lifeOsService: life, ownerTelegramId: '101' });
    const messages = new TelegramMessageService({
      accessPolicy: createTelegramAccessPolicy(['101', '202']), updateRepository: new TelegramUpdateRepository(pool),
      userRepository: users, conversationRepository: conversations, menuService: menu,
      assistant: { async answer() { return 'fixture'; } },
    });
    let updateId = 1;
    const input = (text, id = 101, chat = id) => messages.handle({ update_id: updateId++, message: {
      message_id: updateId, from: { id, first_name: 'Fixture' }, chat: { id: chat, type: 'private' }, text,
    } });
    const callback = (data, id = 101, chat = id) => messages.handleCallback({ update_id: updateId++, callback_query: {
      id: `callback-${updateId}`, from: { id, first_name: 'Fixture' }, message: { message_id: updateId, chat: { id: chat, type: 'private' } }, data,
    } });
    await input('/start'); await input('/start', 202);
    const owner = await users.findByIdentity('telegram', '101');
    const conversation = await conversations.getOrCreate({ userId: owner.id, channel: 'telegram', externalChatId: '101' });
    const scope = { userId: owner.id, conversationId: conversation.id, chatId: '101' };
    const started = await callback('life:r:new'); assert.match(started.answer, /МСК/);
    const active = (await interactions.getActive(scope)).interaction; assert.ok(active);
    const invalid = await input('Fixture | 2030-02-30 23:46'); assert.match(invalid.answer, /Повтори ввод/);
    assert.equal((await interactions.getActive(scope)).interaction.id, active.id);
    await input('Fixture | 2030-10-18 23:46', 202);
    await input('Fixture | 2030-10-18 23:46', 101, 999);
    assert.equal((await reminders.list({ userId: owner.id, states: ['scheduled'], limit: 10 })).length, 0);
    const saved = await input('Fixture | 2030-10-18 23:46'); assert.match(saved.answer, /обновлён/);
    const rows = await reminders.list({ userId: owner.id, states: ['scheduled'], limit: 10 }); assert.equal(rows.length, 1);
    const reminder = rows[0]; assert.equal(new Date(reminder.trigger_at).toISOString(), '2030-10-18T20:46:00.000Z');
    assert.equal((await interactions.getActive(scope)).interaction, null);
    await input('Fixture | 2030-10-18 23:46');
    assert.equal((await reminders.list({ userId: owner.id, states: ['scheduled'], limit: 10 })).length, 1);
    const view = await callback(`life:r:v:${reminder.id}`); assert.match(view.answer, /18\.10\.2030.*23:46:00.*МСК/);
    await callback(`life:r:edit:${reminder.id}:${reminder.revision}`);
    await input('2030-10-19 00:01');
    const moved = await reminders.get({ userId: owner.id, reminderId: reminder.id });
    assert.equal(new Date(moved.trigger_at).toISOString(), '2030-10-18T21:01:00.000Z');
    const movedView = await callback(`life:r:v:${reminder.id}`); assert.match(movedView.answer, /19\.10\.2030.*00:01:00.*МСК/);
    await callback(`life:r:edit:${reminder.id}:${moved.revision}`, 202); await input('2030-10-20 12:00', 202);
    assert.equal((await reminders.get({ userId: owner.id, reminderId: reminder.id })).revision, moved.revision);
    await callback('life:r:new');
    await pool.query('UPDATE telegram_interactions SET expires_at=now()-interval \'1 second\' WHERE user_id=$1', [owner.id]);
    assert.match((await input('Expired | 2030-10-20 12:00')).answer, /Время ввода закончилось/);
    assert.equal((await reminders.list({ userId: owner.id, states: ['scheduled'], limit: 10 })).length, 1);
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
