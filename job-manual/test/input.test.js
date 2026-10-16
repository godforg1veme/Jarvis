'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
async function inputModule() {
  const source = await fs.readFile(require.resolve('../public/input.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
test('mobile Cyrillic and supplementary Unicode become key events without clipboard', async () => {
  const { sendText } = await inputModule(); const keys = [];
  sendText({ sendKey: (...args) => keys.push(args) }, 'AяЁ😀\n');
  assert.deepEqual(keys, [[65, null], [0x0100044f, null], [0x01000401, null], [0x0101f600, null]]);
});
test('mobile composition waits for confirmation and does not duplicate committed text', async () => {
  const { bindKeyboard } = await inputModule(); const handlers = new Map(), keys = [];
  const input = { value: '', addEventListener: (name, handler) => handlers.set(name, handler) };
  bindKeyboard(input, () => ({ sendKey: (...args) => keys.push(args) }));
  handlers.get('compositionstart')({}); input.value = 'я'; handlers.get('input')({ isComposing: true }); assert.equal(keys.length, 0);
  handlers.get('compositionend')({}); handlers.get('input')({}); assert.deepEqual(keys, [[0x0100044f, null]]);
  handlers.get('input')({ inputType: 'deleteContentBackward' }); assert.deepEqual(keys[1], [0xff08, 'Backspace']);
});
