const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramBot, telegramReplyMarkup } = require('../src/telegram/bot');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramCallbackPages, PAGE_CALLBACK_RE } = require('../src/telegram/telegramCallbackPages');
const { cardView, letterModeView } = require('../src/jobs/jobTelegramViews');

const vacancy = { id: '11111111-1111-4111-8111-111111111111', snapshot: {
  title: 'Разработчик', company: 'Компания', publishedAt: '2026-10-24T07:00:00Z', url: 'https://hh.ru/vacancy/123',
} };
const draftId = '22222222-2222-4222-8222-222222222222';

function update(id, data, { userId = 101, chatId = 101, messageId = 10, text = 'Карточка в 10:00' } = {}) {
  return { update_id: id, callback_query: { id: `callback-${id}`, data,
    from: { id: userId, first_name: 'User' }, message: { message_id: messageId, date: 1,
      from: { id: 123456, is_bot: true, first_name: 'Jarvis' }, chat: { id: chatId, type: 'private' }, text } } };
}

async function harness({ answer, failEdit, access } = {}) {
  const api = [], actions = [], logs = [], history = [], claims = new Set();
  let permissions = ['jobs', 'assistant'];
  const service = new TelegramMessageService({
    accessPolicy: { async isAllowed(id) { return id !== '999'; } },
    updateRepository: { async claim(id) { if (claims.has(id)) return false; claims.add(id); return true; }, async markCompleted() {} },
    userRepository: { async findOrCreateTelegramUser({ telegramUserId }) { return { id: `user-${telegramUserId}` }; } },
    conversationRepository: { async getOrCreate({ userId, externalChatId }) { return { id: `${userId}:${externalChatId}` }; },
      async appendMessage(message) { history.push(message); } },
    accessService: { async getAccessForUser() { return { blocked: false, permissions }; },
      async getAccessForTelegram() { return { blocked: false, permissions: access ? access() : permissions }; } },
    menuService: { async handleCallback(data) {
      actions.push(data);
      if (data.startsWith('job:prepare:')) return letterModeView(vacancy);
      if (data.startsWith('job:view:')) return cardView(vacancy);
      if (data === 'job:back') return { answer: 'Главная', replyKeyboard: { keyboard: [[{ text: '🏠 Главное' }]] }, jobSearchEntry: true };
      return { answer: answer || 'Готово', plainText: true, disableLinkPreview: true,
        buttons: [[{ text: 'Отправить отклик', data: `job:send:${draftId}` }], [{ text: 'Назад к вакансии', data: `job:view:${vacancy.id}` }]] };
    } },
  });
  const bot = createTelegramBot({ token: '123456:TESTTOKEN', messageService: service,
    logger: { error(entry) { logs.push(entry); }, warn(entry) { logs.push(entry); } } });
  bot.api.config.use(async (_previous, method, payload) => {
    if (method === 'getMe') return { ok: true, result: { id: 123456, is_bot: true, first_name: 'Jarvis', username: 'fixture_bot' } };
    api.push({ method, payload });
    if (method === 'editMessageText' && failEdit) return failEdit(payload);
    return { ok: true, result: method === 'answerCallbackQuery' ? true
      : { message_id: payload.message_id || 900, date: 1, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } };
  });
  await bot.init();
  return { bot, api, actions, logs, history, service, revoke() { permissions = ['assistant']; } };
}

test('old vacancy, letter selection and back edit the clicked message despite newer cards below', async () => {
  const h = await harness();
  await h.bot.api.sendMessage(101, 'Новая вакансия в 11:00');
  h.api.length = 0;
  for (const [id, data] of [[1, `job:prepare:${vacancy.id}`], [2, `job:view:${vacancy.id}`], [3, 'job:back']]) {
    await h.bot.handleUpdate(update(id, data));
  }
  const edits = h.api.filter((call) => call.method === 'editMessageText');
  assert.equal(edits.length, 3);
  assert.ok(edits.every(({ payload }) => payload.chat_id === 101 && payload.message_id === 10));
  assert.equal(edits[0].payload.reply_markup.inline_keyboard.at(-1)[0].callback_data, `job:view:${vacancy.id}`);
  assert.equal(edits[1].payload.reply_markup.inline_keyboard[1][0].callback_data, `job:prepare:${vacancy.id}`);
  assert.equal(edits[2].payload.reply_markup.inline_keyboard[0][0].callback_data, 'job:menu');
  assert.equal(h.api.some((call) => call.method === 'sendMessage'), false);
});

test('long callback text pages in place without repeating the action or persisting page text', async () => {
  const answer = 'Личный текст письма. '.repeat(500);
  const h = await harness({ answer });
  await h.bot.handleUpdate(update(10, `job:draft:${draftId}`));
  let payload = h.api.find((call) => call.method === 'editMessageText').payload;
  const parts = [payload.text.replace(/\n\nСтраница \d+\/\d+$/, '')];
  assert.ok(!payload.reply_markup.inline_keyboard.flat().some((b) => b.callback_data.startsWith('job:send:')));
  assert.ok(payload.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === `job:view:${vacancy.id}`));
  for (let id = 11; ; id++) {
    const next = payload.reply_markup.inline_keyboard.flat().find((b) => b.text === 'Текст →');
    if (!next) break;
    assert.match(next.callback_data, PAGE_CALLBACK_RE);
    assert.ok(Buffer.byteLength(next.callback_data) <= 64);
    await h.bot.handleUpdate(update(id, next.callback_data));
    payload = h.api.filter((call) => call.method === 'editMessageText').at(-1).payload;
    assert.equal(payload.message_id, 10);
    assert.ok(payload.text.length <= 4000);
    parts.push(payload.text.replace(/\n\nСтраница \d+\/\d+$/, ''));
  }
  assert.equal(parts.join(''), answer);
  assert.ok(payload.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === `job:send:${draftId}`));
  assert.deepEqual(h.actions, [`job:draft:${draftId}`]);
  assert.equal(h.history.length, 1);
  assert.equal(h.api.some((call) => call.method === 'sendMessage'), false);
  assert.equal(JSON.stringify(h.logs).includes('Личный текст'), false);
});

test('page callbacks reject foreign user, chat, message, revoked access, expired cache and duplicate updates', async () => {
  const h = await harness({ answer: 'Секретное письмо '.repeat(500) });
  await h.bot.handleUpdate(update(20, `job:draft:${draftId}`));
  const data = h.api.find((c) => c.method === 'editMessageText').payload.reply_markup.inline_keyboard.flat().find((b) => b.text === 'Текст →').callback_data;
  h.api.length = 0;
  for (const [id, scope] of [[21, { userId: 202 }], [22, { chatId: 202 }], [23, { messageId: 11 }]]) {
    await h.bot.handleUpdate(update(id, data, scope));
  }
  assert.equal(h.api.filter((c) => c.method === 'editMessageText').length, 0);
  assert.equal(h.api.filter((c) => c.payload.show_alert).length, 3);
  h.revoke();
  await h.bot.handleUpdate(update(24, data));
  assert.match(h.api.at(-1).payload.text, /текущими правами/);
  await h.bot.handleUpdate(update(24, data));
  assert.equal(h.api.filter((c) => c.method === 'editMessageText').length, 0);
  h.service.callbackPages = new TelegramCallbackPages(); // Server restart discards previews.
  await h.bot.handleUpdate(update(25, data));
  assert.ok(!JSON.stringify(h.api).includes('Секретное письмо'));
  assert.equal(h.actions.length, 1);
});

test('page cache expires, bounds entries and invalidates old navigation at the same message', () => {
  let time = 0;
  const pages = new TelegramCallbackPages({ now: () => time, ttlMs: 1000, maxEntries: 2 });
  const input = { data: 'job:menu', telegramUserId: '101', chatId: '101', messageId: '10', userId: 'u', conversationId: 'c', textMessage: true };
  const result = { status: 'answered', answer: 'x'.repeat(5000) };
  const first = pages.prepare(result, input).buttons[0][0].data;
  assert.ok(pages.lookup({ ...input, data: first }));
  time = 1001;
  assert.equal(pages.lookup({ ...input, data: first }), null);
  const second = pages.prepare(result, input).buttons[0][0].data;
  pages.prepare({ status: 'answered', answer: 'Назад' }, input);
  assert.equal(pages.lookup({ ...input, data: second }), null);
  for (let i = 0; i < 3; i++) pages.prepare(result, { ...input, messageId: String(i) });
  assert.equal(pages.entries.size, 2);
  for (const id of pages.entries.keys()) pages.remove(id);
});

test('only the exact not-modified Bot API response is treated as successful editing', async () => {
  const h = await harness({ failEdit() { return { ok: false, error_code: 400,
    description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' }; } });
  await h.bot.handleUpdate(update(30, `job:view:${vacancy.id}`));
  assert.equal(h.api.filter((c) => c.method === 'editMessageText').length, 1);
  assert.equal(h.api.some((c) => c.method === 'sendMessage'), false);
  assert.deepEqual(h.logs, []);
  assert.throws(() => telegramReplyMarkup([[{ text: 'bad', data: 'pg:arbitrary:999' }]]));
});

test('a failed edit shows a safe callback alert without a new message or repeated action', async () => {
  const h = await harness({ failEdit() { throw new Error('transport URL with 123456:TESTTOKEN private answer'); } });
  await h.bot.handleUpdates([update(40, `job:send:${draftId}`)]);
  assert.equal(h.actions.length, 1);
  assert.equal(h.api.filter((c) => c.method === 'editMessageText').length, 1);
  assert.equal(h.api.some((c) => c.method === 'sendMessage'), false);
  assert.match(h.api.at(-1).payload.text, /проверь его состояние/);
  assert.equal(h.api.at(-1).payload.show_alert, true);
  assert.equal(h.api.filter((c) => c.method === 'answerCallbackQuery').length, 1, 'the failure alert is the first answer to this callback');
  assert.deepEqual(h.logs, [{ telegramFailureCode: 'TELEGRAM_DELIVERY_FAILED', updateId: 40 }]);
});

test('late permission revocation blocks a cached page after the first access check', async () => {
  let denied = false;
  const h = await harness({ answer: 'Письмо '.repeat(1000), access: () => denied ? ['assistant'] : ['jobs', 'assistant'] });
  await h.bot.handleUpdate(update(50, `job:draft:${draftId}`));
  const data = h.api.find((c) => c.method === 'editMessageText').payload.reply_markup.inline_keyboard.flat().find((b) => b.text === 'Текст →').callback_data;
  h.api.length = 0;
  denied = true;
  await h.bot.handleUpdate(update(51, data));
  assert.equal(h.api.some((c) => c.method === 'editMessageText'), false);
  assert.match(h.api.at(-1).payload.text, /текущими правами/);
});

test('concurrent clicks on the same message complete in order and cannot restore an old page', async () => {
  let started, release;
  const entered = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let edits = 0;
  const h = await harness({ answer: 'Длинное письмо '.repeat(500), failEdit: async (payload) => {
    if (++edits === 1) { started(); await blocked; }
    return { ok: true, result: { message_id: payload.message_id, date: 1, chat: { id: 101, type: 'private' }, text: payload.text } };
  } });
  const first = h.bot.handleUpdate(update(60, `job:draft:${draftId}`));
  await entered;
  const next = h.bot.handleUpdate(update(61, `job:view:${vacancy.id}`));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.actions, [`job:draft:${draftId}`]);
  release();
  await Promise.all([first, next]);
  assert.deepEqual(h.actions, [`job:draft:${draftId}`, `job:view:${vacancy.id}`]);
  assert.match(h.api.filter((c) => c.method === 'editMessageText').at(-1).payload.text, /^Разработчик/);
  assert.equal(h.service.callbackPages.entries.size, 0);
});

test('terminal callback removes old controls, typed messages and media retain normal delivery', async () => {
  const { sendResult } = require('../src/telegram/bot');
  const sent = [], edited = [], photos = [];
  const ctx = { callbackQuery: { message: update(1, 'job:menu').callback_query.message },
    async editMessageText(text, options) { edited.push({ text, options }); },
    async reply(text) { sent.push(text); }, async replyWithPhoto() { photos.push(true); } };
  await sendResult(ctx, { status: 'answered', answer: '**Готово**' });
  assert.deepEqual(edited[0], { text: '<b>Готово</b>', options: { parse_mode: 'HTML',
    link_preview_options: { is_disabled: false }, reply_markup: { inline_keyboard: [] } } });
  await sendResult(ctx, { status: 'answered', answer: 'Фото', media: { kind: 'photo', filename: 'captcha.jpg',
    contentType: 'image/jpeg', content: Buffer.from([0xff, 0xd8, 0xff]), caption: 'HH CAPTCHA' } });
  delete ctx.callbackQuery;
  await sendResult(ctx, { status: 'answered', answer: 'Обычный ответ' });
  assert.deepEqual(sent, ['Обычный ответ']);
  assert.equal(photos.length, 1);
});
