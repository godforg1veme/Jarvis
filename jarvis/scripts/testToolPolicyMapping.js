const assert = require('assert');
const {
  POLICY,
  USER_ACTION_CATEGORY,
  categoryForAction,
  categoryForPolicy,
} = require('../agents/toolPolicy');

assert.strictEqual(categoryForPolicy(POLICY.OBSERVE), USER_ACTION_CATEGORY.SAFE);
assert.strictEqual(categoryForPolicy(POLICY.LOW_RISK), USER_ACTION_CATEGORY.SAFE);
assert.strictEqual(categoryForPolicy(POLICY.CONFIRM), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForPolicy(POLICY.STRONG), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForAction('file.search'), USER_ACTION_CATEGORY.SAFE);
assert.strictEqual(categoryForAction('file.copy'), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForAction('file.copy', { overwrite: true }), USER_ACTION_CATEGORY.CHANGING);
assert.strictEqual(categoryForAction('unknown.action'), '');

console.log('[testToolPolicyMapping] tool policy mapping tests passed');
