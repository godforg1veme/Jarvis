const assert = require('node:assert/strict');
const test = require('node:test');
const { TELEGRAM_CALLBACK_RE, createTelegramBot, downloadTelegramAttachment, replyWithChunks, sendResult, splitTelegramText, validatedMedia, validatedReplyKeyboard, vpnReplyMarkup } = require('../src/telegram/bot');
const { formatTelegramHtml } = require('../src/telegram/telegramFormatting');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');
const { TelegramMessageService } = require('../src/telegram/messageService');

test('splits long Telegram replies without losing text', () => {
  const text = `${'а'.repeat(2500)} ${'б'.repeat(2500)}`;
  const chunks = splitTelegramText(text);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(' '), text);
});

test('accepts only the closed bounded VPN Supervisor callback grammar', () => {
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpsup:allow:11111111-1111-4111-8111-111111111111'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpsup:details:11111111-1111-4111-8111-111111111111'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpsup:run:rm -rf /'), false);
});

test('renders restrained Markdown as safe Telegram HTML', () => {
  assert.equal(
    formatTelegramHtml('**Важно:** <script>alert(1)</script> и `a < b`'),
    '<b>Важно:</b> &lt;script&gt;alert(1)&lt;/script&gt; и <code>a &lt; b</code>',
  );
  assert.equal(formatTelegramHtml('*курсив* и ~~зачёркнуто~~'), '<i>курсив</i> и <s>зачёркнуто</s>');
  assert.equal(
    formatTelegramHtml('• Настройки → Маршрутизация -> Выбор => OK'),
    '• Настройки → Маршрутизация -&gt; Выбор =&gt; OK',
  );
  assert.equal(
    formatTelegramHtml('[Happ](https://happ.su)\n> Цитата'),
    '<a href="https://happ.su">Happ</a>\n<blockquote>Цитата</blockquote>',
  );
  assert.equal(
    formatTelegramHtml('<b>Жирный HTML</b> и <code>код</code>'),
    '<b>Жирный HTML</b> и <code>код</code>',
  );
});

test('sends Telegram replies with HTML parsing enabled', async () => {
  const calls = [];
  await replyWithChunks({
    async reply(text, options) { calls.push({ text, options }); },
  }, '**Когда их класть:**\nСначала обжарь лук.');

  assert.deepEqual(calls, [{
    text: '<b>Когда их класть:</b>\nСначала обжарь лук.',
    options: { parse_mode: 'HTML' },
  }]);
});

test('renders only closed bounded VPN inline buttons on the final reply', async () => {
  const calls = [];
  await replyWithChunks({
    async reply(text, options) { calls.push({ text, options }); },
  }, 'Управление VPN:', [[{ text: 'Статус', data: 'vpn:status' }]]);
  assert.deepEqual(calls[0].options.reply_markup, {
    inline_keyboard: [[{ text: 'Статус', callback_data: 'vpn:status' }]],
  });
  assert.throws(() => vpnReplyMarkup([[{ text: 'Shell', data: 'vpn:shell:whoami' }]]), /invalid VPN button/);
  assert.throws(() => vpnReplyMarkup([[{ text: 'X', data: `vpn:confirm:${'a'.repeat(80)}` }]]), /invalid VPN button/);
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Hysteria2', data: 'vpn:p:h' }], [{ text: 'Статус', data: 'vpn:h:status' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Диагностика', data: 'vpn:health' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Экспорт', data: 'vpn:h:export:vpn-0123456789ab' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Проверить ключ', data: 'vpn:probe:recheck:nl:h' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Память', data: 'mem:edit:33333333-3333-4333-8333-333333333333' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Устройство', data: 'dev:task:33333333-3333-4333-8333-333333333333' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Отмена', data: 'flow:cancel:33333333-3333-4333-8333-333333333333' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Фото', data: 'gallery:open:d:33333333-3333-4333-8333-333333333333:0' }]]));

  const { menuButtons, countryProtocolButtons, protocolButtons } = require('../src/vpn/vpnCommandService');
  assert.doesNotThrow(() => vpnReplyMarkup(menuButtons()));
  assert.doesNotThrow(() => vpnReplyMarkup(countryProtocolButtons('de')));
  assert.doesNotThrow(() => vpnReplyMarkup(countryProtocolButtons('nl')));
  assert.doesNotThrow(() => vpnReplyMarkup(protocolButtons('hysteria2', 'de')));
  assert.doesNotThrow(() => vpnReplyMarkup(protocolButtons('vless', 'de')));
  assert.doesNotThrow(() => vpnReplyMarkup(protocolButtons('hysteria2', 'nl')));
  assert.doesNotThrow(() => vpnReplyMarkup(protocolButtons('vless', 'nl')));
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:c:de'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:c:nl'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:nl:h:status'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:de:v:clients'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:nl:h:export:vpn-0123456789ab'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:probe:recheck:nl:h'), true);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:probe:recheck:xx:h'), false);
  assert.equal(TELEGRAM_CALLBACK_RE.test('vpn:c:invalid'), false);
});

test('renders persistent bottom navigation separately from inline buttons', async () => {
  const keyboard = { keyboard: [[{ text: '🏠 Главное' }, { text: '❓ Помощь' }]], resize_keyboard: true, is_persistent: true };
  assert.deepEqual(validatedReplyKeyboard(keyboard), keyboard);
  const calls = [];
  await replyWithChunks({ async reply(text, options) { calls.push({ text, options }); } }, 'Готово', undefined, keyboard);
  assert.deepEqual(calls[0].options.reply_markup, keyboard);
  await assert.rejects(
    replyWithChunks({ async reply() {} }, 'Нет', [[{ text: 'Статус', data: 'vpn:status' }]], keyboard),
    /cannot mix/,
  );
});

test('allows only the exact configured Operations panel URL or public routing URL', () => {
  const expected = 'https://ops.example.test/ops/';
  assert.deepEqual(vpnReplyMarkup([[{ text: 'Открыть', url: expected }]], { operationsPanelUrl: expected }), {
    inline_keyboard: [[{ text: 'Открыть', url: expected }]],
  });
  assert.deepEqual(vpnReplyMarkup([[{ text: 'Активировать', url: 'https://jarvis.rilora.ru/happ-routing' }]]), {
    inline_keyboard: [[{ text: 'Активировать', url: 'https://jarvis.rilora.ru/happ-routing' }]],
  });
  assert.throws(() => vpnReplyMarkup([[{ text: 'Подмена', url: 'https://evil.example/ops/' }]], { operationsPanelUrl: expected }), /invalid VPN button/);
  assert.throws(() => vpnReplyMarkup([[{ text: 'JS', url: 'javascript:alert(1)' }]], { operationsPanelUrl: expected }), /invalid VPN button/);
});

test('Telegram attachment download bounds bytes and never exposes the bot token in errors', async () => {
  const ctx = { async getFile() { return { file_path: 'documents/private.txt' }; } };
  const buffer = await downloadTelegramAttachment(ctx, 'token-must-not-leak', 10, async () => new Response('hello', { status: 200 }));
  assert.equal(buffer.toString(), 'hello');
  await assert.rejects(
    downloadTelegramAttachment(ctx, 'token-must-not-leak', 2, async () => new Response('hello', { status: 200 })),
    (error) => error.message === 'Telegram document download failed' && !error.message.includes('token-must-not-leak'),
  );
});

test('sends a validated Hysteria2 artifact and rejects a mismatched kind', async () => {
  const documents = [];
  const ctx = {
    async reply() {},
    async replyWithDocument(document) { documents.push(document); },
  };
  await sendResult(ctx, {
    status: 'answered', answer: 'Готово',
    artifact: { kind: 'happ-hysteria2', filename: 'iPhone-hysteria2.txt', content: 'hy2://secret@example.test:443/\n' },
  });
  assert.equal(documents.length, 1);
  await sendResult(ctx, {
    status: 'answered', answer: 'Маршрутизация',
    artifact: { kind: 'happ-routing', filename: 'jarvis-ru-direct-routing.json', content: '{"Name":"test"}\n' },
  });
  assert.equal(documents.length, 2);
  await assert.rejects(sendResult(ctx, {
    status: 'answered', answer: 'Нет',
    artifact: { kind: 'happ-vless', filename: 'wrong.txt', content: 'hy2://secret\n' },
  }), /invalid VPN artifact/);
});

test('sends bounded gallery media with decision buttons and does not send duplicate text', async () => {
  const photos = [];
  const ctx = {
    async reply() { throw new Error('media preview must not send a duplicate text message'); },
    async replyWithPhoto(photo, options) { photos.push({ photo, options }); },
  };
  const content = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
  await sendResult(ctx, {
    status: 'answered', answer: 'Файл отправлен для просмотра.',
    media: {
      kind: 'photo', content, contentType: 'image/jpeg', filename: 'photo.jpg', caption: 'Удалить или оставить?',
      buttons: [[{ text: 'Оставить', data: 'gallery:keep:0' }]],
    },
  }, { mediaMaxBytes: 1024 });
  assert.equal(photos.length, 1);
  assert.equal(photos[0].options.reply_markup.inline_keyboard[0][0].callback_data, 'gallery:keep:0');
  assert.throws(() => validatedMedia({ kind: 'photo', content, contentType: 'application/pdf', filename: 'photo.jpg' }), /photo/);
  assert.throws(() => validatedMedia({ kind: 'photo', content: Buffer.from('not-a-jpeg'), contentType: 'image/jpeg', filename: 'photo.jpg' }), /photo/);
  assert.throws(() => validatedMedia({ kind: 'document', content, contentType: 'application/pdf', filename: '../secret' }), /filename/);
  assert.throws(() => validatedMedia({ kind: 'document', content: Buffer.alloc(2), contentType: 'application/pdf', filename: 'a.pdf' }, { mediaMaxBytes: 1 }), /media/);
});

test('incoming Telegram message reaches the sender with a safe model-failure fallback', async () => {
  const persistedUpdates = new Map();
  const logs = [];
  const outbound = [];
  const apiMethods = [];
  const rawInput = 'содержимое личного сообщения';
  const rawProviderError = 'OpenRouter private diagnostic and secret detail';
  const messageService = new TelegramMessageService({
    accessPolicy: createTelegramAccessPolicy(['101']),
    updateRepository: {
      async claim(updateId, telegramUserId, updateKind) {
        if (persistedUpdates.has(updateId)) return false;
        persistedUpdates.set(updateId, { telegramUserId, updateKind, status: 'processing' });
        return true;
      },
      async markCompleted(updateId) { persistedUpdates.get(updateId).status = 'completed'; },
      async markFailed(updateId, failureCode) {
        persistedUpdates.set(updateId, { ...persistedUpdates.get(updateId), status: 'failed', failureCode });
      },
    },
    userRepository: { async findOrCreateTelegramUser() { return { id: 'owner-1' }; } },
    conversationRepository: {
      async getOrCreate() { return { id: 'conversation-1' }; },
      async appendMessage() {},
      async recentMessages() { return []; },
    },
    assistant: { async answer() { throw new Error(rawProviderError); } },
    menuService: {
      async handleMenuAction() { return null; },
      async handlePendingText() { return null; },
      async handleCallback() { throw new Error('menu private backend detail'); },
    },
    logger: { warn(entry) { logs.push(entry); } },
  });
  const bot = createTelegramBot({
    token: '123456:TESTTOKEN',
    messageService,
    logger: { error(entry) { logs.push(entry); }, warn(entry) { logs.push(entry); } },
  });
  bot.api.config.use(async (_previous, method, payload) => {
    apiMethods.push(method);
    if (method === 'getMe') {
      return { ok: true, result: { id: 123456, is_bot: true, first_name: 'Jarvis', username: 'test_jarvis_bot' } };
    }
    if (method === 'sendMessage') {
      outbound.push(payload.text);
      return { ok: true, result: { message_id: 99, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } };
    }
    return { ok: true, result: true };
  });

  await bot.init();
  const messageUpdate = {
    update_id: 9901,
    message: {
      message_id: 11,
      date: 0,
      from: { id: 101, first_name: 'Owner' },
      chat: { id: 101, type: 'private' },
      text: rawInput,
    },
  };
  await bot.handleUpdate(messageUpdate);
  await bot.handleUpdate(messageUpdate);
  await bot.handleUpdate({
    update_id: 9902,
    callback_query: {
      id: 'callback-9902',
      from: { id: 101, first_name: 'Owner' },
      message: { message_id: 12, date: 0, chat: { id: 101, type: 'private' } },
      data: 'mem:menu',
    },
  });
  await bot.handleUpdate({
    update_id: 9903,
    message: {
      message_id: 13,
      date: 0,
      from: { id: 999, first_name: 'Denied' },
      chat: { id: 999, type: 'private' },
      text: 'untrusted private input',
    },
  });

  assert.equal(outbound.length, 3);
  assert.equal(apiMethods.filter((method) => method === 'answerCallbackQuery').length, 1);
  assert.equal(persistedUpdates.has(9903), false);
  assert.equal(outbound[2], 'Доступ к этому Jarvis не разрешён.');
  assert.match(outbound[0], /Модель сейчас временно недоступна/);
  assert.match(outbound[1], /Не удалось завершить это сообщение/);
  assert.equal(outbound[0].includes(rawProviderError), false);
  assert.equal(outbound[1].includes('menu private backend detail'), false);
  assert.deepEqual(persistedUpdates.get(9901), {
    telegramUserId: '101',
    updateKind: 'message',
    status: 'failed',
    failureCode: 'MODEL_UNAVAILABLE',
  });
  assert.equal(JSON.stringify(logs).includes(rawProviderError), false);
  assert.equal(JSON.stringify(logs).includes(rawInput), false);
  assert.deepEqual(logs[0], {
    telegramFailureCode: 'MODEL_UNAVAILABLE',
    telegramFailurePhase: 'message',
    updateId: 9901,
  });
  assert.deepEqual(persistedUpdates.get(9902), {
    telegramUserId: '101',
    updateKind: 'callback',
    status: 'failed',
    failureCode: 'DIALOGUE_UNAVAILABLE',
  });
  assert.equal(JSON.stringify(logs).includes('menu private backend detail'), false);
});

test('Telegram delivery failure uses a safe fallback and logs no reply or transport secret', async () => {
  const logs = [];
  const sent = [];
  const bot = createTelegramBot({
    token: '123456:TESTTOKEN',
    messageService: { async handle() { return { status: 'answered', answer: 'private answer' }; } },
    logger: { error(entry) { logs.push(entry); }, warn(entry) { logs.push(entry); } },
  });
  bot.api.config.use(async (_previous, method, payload) => {
    if (method === 'getMe') return { ok: true, result: { id: 123456, is_bot: true, first_name: 'Jarvis', username: 'test_jarvis_bot' } };
    if (method === 'sendMessage') {
      sent.push(payload.text);
      if (sent.length === 1) throw new Error('transport URL with 123456:TESTTOKEN');
      return { ok: true, result: { message_id: 99, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } };
    }
    return { ok: true, result: true };
  });
  await bot.init();
  await bot.handleUpdates([{
    update_id: 9904,
    message: { message_id: 14, date: 0, from: { id: 101, first_name: 'Owner' }, chat: { id: 101, type: 'private' }, text: 'private input' },
  }]);
  assert.deepEqual(sent, ['private answer', 'Не удалось завершить это сообщение. Попробуй ещё раз; меню и остальные разделы Jarvis продолжают работать.']);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], { telegramFailureCode: 'TELEGRAM_DELIVERY_FAILED', updateId: 9904 });
  assert.equal(JSON.stringify(logs).includes('123456:TESTTOKEN'), false);
  assert.equal(JSON.stringify(logs).includes('private input'), false);
});

test('failed fallback delivery logs a distinct closed code without leaking the token', async () => {
  const logs = [];
  const bot = createTelegramBot({
    token: '123456:TESTTOKEN',
    messageService: { async handle() { return { status: 'answered', answer: 'private answer' }; } },
    logger: { error(entry) { logs.push(entry); }, warn(entry) { logs.push(entry); } },
  });
  bot.api.config.use(async (_previous, method) => {
    if (method === 'getMe') return { ok: true, result: { id: 123456, is_bot: true, first_name: 'Jarvis', username: 'test_jarvis_bot' } };
    throw new Error('transport URL with 123456:TESTTOKEN');
  });
  await bot.init();
  await bot.handleUpdates([{
    update_id: 9905,
    message: { message_id: 15, date: 0, from: { id: 101, first_name: 'Owner' }, chat: { id: 101, type: 'private' }, text: 'private input' },
  }]);
  assert.deepEqual(logs, [
    { telegramFailureCode: 'TELEGRAM_DELIVERY_FAILED', updateId: 9905 },
    { telegramFailureCode: 'TELEGRAM_FALLBACK_DELIVERY_FAILED', updateId: 9905 },
  ]);
  assert.equal(JSON.stringify(logs).includes('123456:TESTTOKEN'), false);
});
