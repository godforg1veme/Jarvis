const assert = require('node:assert/strict');
const test = require('node:test');
const { MENU, isOwner, menuAction, replyKeyboard } = require('../src/telegram/telegramMenu');

test('builds distinct persistent keyboards for owner and family member', () => {
  const owner = replyKeyboard(true);
  const member = replyKeyboard(false);
  assert.equal(owner.is_persistent, true);
  assert.equal(owner.resize_keyboard, true);
  assert.equal(owner.keyboard.flat().some((button) => button.text === MENU.VPN), true);
  assert.equal(owner.keyboard.flat().some((button) => button.text === MENU.OPERATIONS), true);
  assert.equal(member.keyboard.flat().some((button) => button.text === MENU.VPN), false);
  assert.equal(member.keyboard.flat().some((button) => button.text === MENU.OPERATIONS), false);
  assert.equal(member.keyboard.flat().some((button) => button.text === MENU.HELP), true);
  assert.equal(owner.keyboard.flat().some((button) => button.text === MENU.JOBS), false);
  assert.equal(replyKeyboard(true, { jobSearchEnabled: true }).keyboard.at(-1)[0].text, MENU.JOBS);
  assert.equal(replyKeyboard(false, { jobSearchEnabled: true }).keyboard.flat().some((button) => button.text === MENU.JOBS), false);
});

test('menu labels use exact matching and roles include configured owner identity', () => {
  assert.equal(menuAction(MENU.DEVICES), 'devices');
  assert.equal(menuAction(MENU.JOBS), 'jobs');
  assert.equal(menuAction('Поиск работы'), null);
  assert.equal(menuAction(` ${MENU.DEVICES}`), null);
  assert.equal(menuAction(MENU.DEVICES.toLowerCase()), null);
  assert.equal(isOwner({ role: 'member' }, '101', '101'), true);
  assert.equal(isOwner({ role: 'member' }, '202', '101'), false);
  assert.equal(isOwner({ role: 'owner' }, '202', '101'), true);
});
