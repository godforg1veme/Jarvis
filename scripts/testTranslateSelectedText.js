const assert = require('assert');
const { translateSelectedText, SELECTED_TEXT_ERROR } = require('../tools/selectedTextTranslator');

async function testTranslatesChangedClipboardText() {
  const calls = [];
  let reads = ['old text', 'hello world'];

  const result = await translateSelectedText({
    readClipboardText: () => reads.shift(),
    copySelectedText: async () => calls.push('copy'),
    translateText: async (text) => {
      calls.push(['translate', text]);
      return 'привет, мир';
    },
    logger: {
      log: (...args) => calls.push(['log', ...args]),
      error: (...args) => calls.push(['error', ...args]),
    },
    waitAfterCopyMs: 0,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.type, 'translate');
  assert.strictEqual(result.content, 'привет, мир');
  assert.strictEqual(result.sourceText, 'hello world');
  assert.deepStrictEqual(calls[0], 'copy');
  assert.deepStrictEqual(calls[1], ['translate', 'hello world']);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'log'));
}

async function testTranslatesTextMatchingPreviousClipboardWhenClipboardCanBeCleared() {
  const calls = [];
  let clipboard = 'hello world';

  const result = await translateSelectedText({
    readClipboardText: () => clipboard,
    writeClipboardText: (text) => {
      clipboard = text;
      calls.push(['write', text]);
    },
    copySelectedText: async () => {
      calls.push('copy');
      clipboard = 'hello world';
    },
    translateText: async (text) => {
      calls.push(['translate', text]);
      return 'привет, мир';
    },
    logger: { log: () => {}, error: () => {} },
    waitAfterCopyMs: 0,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.content, 'привет, мир');
  assert.strictEqual(result.sourceText, 'hello world');
  assert.deepStrictEqual(calls, [['write', ''], 'copy', ['translate', 'hello world']]);
}

async function testRestoresClipboardWhenCopyFailsAfterClearing() {
  let clipboard = 'previous clipboard';
  const writes = [];

  const result = await translateSelectedText({
    readClipboardText: () => clipboard,
    writeClipboardText: (text) => {
      clipboard = text;
      writes.push(text);
    },
    copySelectedText: async () => {},
    translateText: async () => {
      throw new Error('should not translate');
    },
    logger: { log: () => {}, error: () => {} },
    waitAfterCopyMs: 0,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.content, SELECTED_TEXT_ERROR);
  assert.deepStrictEqual(writes, ['', 'previous clipboard']);
  assert.strictEqual(clipboard, 'previous clipboard');
}

async function testUsesExistingClipboardFallbackWhenCopyDoesNotReadSelection() {
  const calls = [];
  let clipboard = 'hello from browser';

  const result = await translateSelectedText({
    readClipboardText: () => clipboard,
    writeClipboardText: (text) => {
      clipboard = text;
      calls.push(['write', text]);
    },
    copySelectedText: async () => {
      calls.push('copy');
    },
    translateText: async (text) => {
      calls.push(['translate', text]);
      return 'привет из браузера';
    },
    logger: { log: (...args) => calls.push(['log', ...args]), error: () => {} },
    waitAfterCopyMs: 0,
    allowExistingClipboardFallback: true,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.content, 'привет из браузера');
  assert.strictEqual(result.sourceText, 'hello from browser');
  assert.strictEqual(clipboard, 'hello from browser');
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'translate' && call[1] === 'hello from browser'));
}

async function testRejectsEmptyClipboard() {
  let translateCalls = 0;

  const result = await translateSelectedText({
    readClipboardText: () => '',
    copySelectedText: async () => {},
    translateText: async () => {
      translateCalls++;
      return 'unused';
    },
    logger: { log: () => {}, error: () => {} },
    waitAfterCopyMs: 0,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.content, SELECTED_TEXT_ERROR);
  assert.strictEqual(translateCalls, 0);
}

async function testRejectsUnchangedClipboardWithoutClipboardWriter() {
  let translateCalls = 0;

  const result = await translateSelectedText({
    readClipboardText: () => 'same text',
    copySelectedText: async () => {},
    translateText: async () => {
      translateCalls++;
      return 'unused';
    },
    logger: { log: () => {}, error: () => {} },
    waitAfterCopyMs: 0,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.content, SELECTED_TEXT_ERROR);
  assert.strictEqual(translateCalls, 0);
}

async function testReturnsTranslationError() {
  const errors = [];

  const result = await translateSelectedText({
    readClipboardText: (() => {
      const values = ['old', 'new'];
      return () => values.shift();
    })(),
    copySelectedText: async () => {},
    translateText: async () => {
      throw new Error('AI unavailable');
    },
    logger: { log: () => {}, error: (...args) => errors.push(args) },
    waitAfterCopyMs: 0,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.type, 'error');
  assert.match(result.content, /AI unavailable/);
  assert.strictEqual(errors.length, 1);
}

async function main() {
  await testTranslatesChangedClipboardText();
  await testTranslatesTextMatchingPreviousClipboardWhenClipboardCanBeCleared();
  await testRestoresClipboardWhenCopyFailsAfterClearing();
  await testUsesExistingClipboardFallbackWhenCopyDoesNotReadSelection();
  await testRejectsEmptyClipboard();
  await testRejectsUnchangedClipboardWithoutClipboardWriter();
  await testReturnsTranslationError();
  console.log('testTranslateSelectedText: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
