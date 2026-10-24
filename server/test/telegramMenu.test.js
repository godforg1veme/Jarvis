const assert = require('node:assert/strict');
const test = require('node:test');
const { MENU, isOwner, menuAction, replyKeyboard } = require('../src/telegram/telegramMenu');

test('builds distinct manually collapsible keyboards for owner and family member', () => {
  const owner = replyKeyboard(true);
  const member = replyKeyboard(false);
  assert.equal(owner.is_persistent, false);
  assert.equal(owner.resize_keyboard, true);
  assert.equal(owner.keyboard.flat().some((button) => button.text === MENU.VPN), true);
  assert.equal(owner.keyboard.flat().some((button) => button.text === MENU.OPERATIONS), true);
  assert.equal(member.keyboard.flat().some((button) => button.text === MENU.VPN), false);
  assert.equal(member.keyboard.flat().some((button) => button.text === MENU.OPERATIONS), false);
  for (const layout of [owner, member, replyKeyboard(false, { permissions: [] })]) {
    assert.equal(layout.is_persistent, false);
    assert.equal(layout.one_time_keyboard, false);
    assert.equal(layout.keyboard.flat().some((button) => /Помощь/.test(button.text)), false);
    assert.equal(layout.keyboard.every((row) => row.length > 0), true);
  }
  assert.equal(owner.keyboard.flat().some((button) => button.text === MENU.JOBS), false);
  assert.equal(replyKeyboard(true, { jobSearchEnabled: true }).keyboard.at(-1)[0].text, MENU.JOBS);
  assert.equal(replyKeyboard(false, { jobSearchEnabled: true }).keyboard.flat().some((button) => button.text === MENU.JOBS), false);
});

test('menu labels use exact matching and only the configured Telegram ID is the owner', () => {
  assert.equal(menuAction(MENU.DEVICES), 'devices');
  assert.equal(menuAction(MENU.JOBS), 'jobs');
  assert.equal(menuAction('Поиск работы'), null);
  assert.equal(menuAction('❓ Помощь'), null);
  assert.equal(menuAction(` ${MENU.DEVICES}`), null);
  assert.equal(menuAction(MENU.DEVICES.toLowerCase()), null);
  assert.equal(isOwner({ role: 'member' }, '101', '101'), true);
  assert.equal(isOwner({ role: 'member' }, '202', '101'), false);
  assert.equal(isOwner({ role: 'owner' }, '202', '101'), false);
});
