const fs = require('node:fs');
const path = require('node:path');

const MAX_INSTRUCTION_BYTES = 32 * 1024;
const FILES = Object.freeze({ core: 'core.ru.md', 'cover-letter': 'cover-letter.ru.md', 'web-search': 'web-search.ru.md' });

function loadInstruction(name, { directory = path.join(__dirname, 'instructions') } = {}) {
  if (!Object.hasOwn(FILES, name)) throw Object.assign(new Error('Unknown instruction'), { code: 'PROMPT_INSTRUCTION_NAME_INVALID' });
  let descriptor;
  try {
    descriptor = fs.openSync(path.join(directory, FILES[name]), 'r');
    const buffer = Buffer.alloc(MAX_INSTRUCTION_BYTES + 1);
    let length = 0;
    for (;;) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
      length += read;
      if (length > MAX_INSTRUCTION_BYTES) throw new Error();
      if (!read) break;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)).trim();
    if (!text) throw new Error();
    return text;
  } catch {
    throw Object.assign(new Error('Required instruction unavailable'), { code: 'PROMPT_INSTRUCTION_UNAVAILABLE' });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

const CORE_INSTRUCTIONS = loadInstruction('core');
const COVER_LETTER_INSTRUCTIONS = loadInstruction('cover-letter');
module.exports = { loadInstruction, CORE_INSTRUCTIONS, COVER_LETTER_INSTRUCTIONS };
