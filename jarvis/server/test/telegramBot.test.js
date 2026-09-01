const assert = require('node:assert/strict');
const test = require('node:test');
const { splitTelegramText } = require('../src/telegram/bot');

test('splits long Telegram replies without losing text', () => {
  const text = `${'а'.repeat(2500)} ${'б'.repeat(2500)}`;
  const chunks = splitTelegramText(text);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(' '), text);
});
