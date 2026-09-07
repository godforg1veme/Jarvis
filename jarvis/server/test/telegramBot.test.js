const assert = require('node:assert/strict');
const test = require('node:test');
const { downloadTelegramAttachment, replyWithChunks, splitTelegramText } = require('../src/telegram/bot');
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

test('Telegram attachment download bounds bytes and never exposes the bot token in errors', async () => {
  const ctx = { async getFile() { return { file_path: 'documents/private.txt' }; } };
  const buffer = await downloadTelegramAttachment(ctx, 'token-must-not-leak', 10, async () => new Response('hello', { status: 200 }));
  assert.equal(buffer.toString(), 'hello');
  await assert.rejects(
    downloadTelegramAttachment(ctx, 'token-must-not-leak', 2, async () => new Response('hello', { status: 200 })),
    (error) => error.message === 'Telegram document download failed' && !error.message.includes('token-must-not-leak'),
  );
});
