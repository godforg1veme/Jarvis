const assert = require('node:assert/strict');
const test = require('node:test');
const { downloadTelegramAttachment, replyWithChunks, sendResult, splitTelegramText, validatedReplyKeyboard, vpnReplyMarkup } = require('../src/telegram/bot');
const { formatTelegramHtml } = require('../src/telegram/telegramFormatting');

test('splits long Telegram replies without losing text', () => {
  const text = `${'а'.repeat(2500)} ${'б'.repeat(2500)}`;
  const chunks = splitTelegramText(text);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(' '), text);
});

test('renders restrained Markdown as safe Telegram HTML', () => {
  assert.equal(
    formatTelegramHtml('**Важно:** <script>alert(1)</script> и `a < b`'),
    '<b>Важно:</b> &lt;script&gt;alert(1)&lt;/script&gt; и <code>a &lt; b</code>',
  );
  assert.equal(formatTelegramHtml('*курсив* и ~~зачёркнуто~~'), '<i>курсив</i> и <s>зачёркнуто</s>');
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
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Экспорт', data: 'vpn:h:export:vpn-0123456789ab' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Память', data: 'mem:edit:33333333-3333-4333-8333-333333333333' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Устройство', data: 'dev:task:33333333-3333-4333-8333-333333333333' }]]));
  assert.doesNotThrow(() => vpnReplyMarkup([[{ text: 'Отмена', data: 'flow:cancel:33333333-3333-4333-8333-333333333333' }]]));
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

test('allows only the exact configured Operations panel URL', () => {
  const expected = 'https://ops.example.test/ops/';
  assert.deepEqual(vpnReplyMarkup([[{ text: 'Открыть', url: expected }]], { operationsPanelUrl: expected }), {
    inline_keyboard: [[{ text: 'Открыть', url: expected }]],
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
  await assert.rejects(sendResult(ctx, {
    status: 'answered', answer: 'Нет',
    artifact: { kind: 'happ-vless', filename: 'wrong.txt', content: 'hy2://secret\n' },
  }), /invalid VPN artifact/);
});
