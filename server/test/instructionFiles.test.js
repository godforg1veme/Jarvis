const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadInstruction, CORE_INSTRUCTIONS, COVER_LETTER_INSTRUCTIONS } = require('../src/prompts/instructionFiles');

test('required instruction files load UTF-8 text independently of cwd', () => {
  assert.match(CORE_INSTRUCTIONS, /самостоятельно выбирай/);
  assert.match(COVER_LETTER_INSTRUCTIONS, /выбранное резюме/);
  assert.equal(loadInstruction('core'), CORE_INSTRUCTIONS);
});

test('instruction loader rejects unknown names rather than resolving paths', () => {
  for (const name of ['../core', '__proto__', 'constructor', 'core.ru.md']) {
    assert.throws(() => loadInstruction(name), { code: 'PROMPT_INSTRUCTION_NAME_INVALID' });
  }
});

test('missing, empty, oversized and invalid UTF-8 instructions fail with safe diagnostics', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-instructions-'));
  try {
    const file = path.join(directory, 'core.ru.md');
    for (const content of [null, ' \n\t', 'x'.repeat(32769), Buffer.from([0xc3, 0x28])]) {
      if (content !== null) fs.writeFileSync(file, content);
      assert.throws(() => loadInstruction('core', { directory }), (error) => {
        assert.equal(error.code, 'PROMPT_INSTRUCTION_UNAVAILABLE');
        assert.equal(error.message.includes(directory), false);
        return true;
      });
    }
    fs.writeFileSync(file, '  Подтверждённый текст\n', 'utf8');
    assert.equal(loadInstruction('core', { directory }), 'Подтверждённый текст');
  } finally { fs.rmSync(directory, { recursive: true }); }
});
