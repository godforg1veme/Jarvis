const assert = require('node:assert/strict');
const test = require('node:test');
const { downloadTelegramAttachment, splitTelegramText } = require('../src/telegram/bot');

test('splits long Telegram replies without losing text', () => {
  const text = `${'а'.repeat(2500)} ${'б'.repeat(2500)}`;
  const chunks = splitTelegramText(text);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(' '), text);
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
