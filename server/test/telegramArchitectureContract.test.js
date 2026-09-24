const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { replyKeyboard } = require('../src/telegram/telegramMenu');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function documentedRows(contract, column) {
  const rows = contract.split(/\r?\n/).filter((line) => /^\| [1-4] \|/.test(line));
  assert.equal(rows.length, 4, 'document all four keyboard rows');
  return rows.map((line) => {
    const cell = line.split('|')[column].trim();
    return cell === 'absent' ? null : cell.split(', ').map((label) => label.replaceAll('`', ''));
  }).filter(Boolean);
}

test('documented owner and member keyboard rows match shipped source exactly', () => {
  const contract = read('docs/telegram-menu-contract.md');
  for (const [owner, column] of [[true, 2], [false, 3]]) {
    const actual = replyKeyboard(owner).keyboard.map((row) => row.map((button) => button.text));
    assert.deepEqual(actual, documentedRows(contract, column));
    assert.equal(replyKeyboard(owner).is_persistent, true);
    assert.equal(replyKeyboard(owner).resize_keyboard, true);
  }
});

test('agents and status index link the architecture and menu authorities', () => {
  const agents = read('AGENTS.md');
  const rootAgents = fs.readFileSync(path.resolve(root, 'AGENTS.md'), 'utf8');
  const index = read('docs/README.md');
  const architecture = read('docs/telegram-button-architecture.md');
  const menu = read('docs/telegram-menu-contract.md');
  for (const name of ['telegram-button-architecture.md', 'telegram-menu-contract.md']) {
    assert.ok(agents.includes(`docs/${name}`));
    assert.ok(index.includes(`| \`${name}\` |`));
  }
  assert.equal(rootAgents, agents, 'the only authoritative agent guide must live at the repository root');
  assert.doesNotMatch(rootAgents, /jarvis\/AGENTS\.md/);
  assert.match(agents, /explicit owner approval in the current task/i);
  assert.match(architecture, /telegram-menu-contract\.md/);
  assert.match(menu, /telegram-button-architecture\.md/);
  assert.match(architecture, /Mandatory change notice and approval/);
  assert.match(menu, /Required regression gate/);
});
