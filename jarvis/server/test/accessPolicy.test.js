const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');

test('Telegram access policy is default deny', () => {
  const policy = createTelegramAccessPolicy(['123', '456']);
  assert.equal(policy.isAllowed(123), true);
  assert.equal(policy.isAllowed('456'), true);
  assert.equal(policy.isAllowed('789'), false);
  assert.equal(policy.isAllowed(undefined), false);
});
