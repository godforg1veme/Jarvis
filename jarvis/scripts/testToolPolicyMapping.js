const assert = require('assert');
const {
  POLICY,
  USER_ACTION_CATEGORY,
  categoryForAction,
  categoryForPolicy,
} = require('../agents/toolPolicy');
const { ACTION_ARG_KEYS: desktopArgKeys } = require('../agents/toolSchemas');
const { ACTION_ARG_KEYS: serverArgKeys, validateCommandInput } = require('../server/src/commands/commandSchemas');

assert.strictEqual(categoryForPolicy(POLICY.OBSERVE), USER_ACTION_CATEGORY.SAFE);
assert.strictEqual(categoryForPolicy(POLICY.LOW_RISK), USER_ACTION_CATEGORY.SAFE);
assert.strictEqual(categoryForPolicy(POLICY.CONFIRM), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForPolicy(POLICY.STRONG), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForAction('file.search'), USER_ACTION_CATEGORY.SAFE);
assert.strictEqual(categoryForAction('file.copy'), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForAction('file.copy', { overwrite: true }), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForAction('unknown.action'), '');
assert.deepStrictEqual(desktopArgKeys, serverArgKeys);
const vision = validateCommandInput({
  deviceId: '11111111-1111-4111-8111-111111111111',
  action: 'vision.capture',
  args: { prompt: 'Что видно на экране?', target: 'screen' },
});
assert.strictEqual(vision.policy, 'observe');
assert.throws(() => validateCommandInput({
  deviceId: '11111111-1111-4111-8111-111111111111',
  action: 'vision.capture',
  args: { prompt: 'Запусти камеру', target: 'camera', startLease: true },
}), /unknown argument/);

console.log('[testToolPolicyMapping] tool policy mapping tests passed');
