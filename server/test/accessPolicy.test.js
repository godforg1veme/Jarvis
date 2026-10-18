const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  effectivePermissions,
  protectTarget,
} = require('../src/access/accessPolicy');
const { schemas } = require('../src/access/accessService');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');
test('Telegram access policy is default deny', () => {
  const policy = createTelegramAccessPolicy(['123', '456']);
  assert.equal(policy.isAllowed(123), true);
  assert.equal(policy.isAllowed('456'), true);
  assert.equal(policy.isAllowed('789'), false);
  assert.equal(policy.isAllowed(undefined), false);
});
test('personal rights override role and block denies all', () => {
  assert.deepEqual(
    effectivePermissions({
      level: 'member',
      rolePermissions: ['jobs', 'life'],
      overrides: { jobs: 'deny', documents: 'allow' },
    }),
    ['life', 'documents'],
  );
  assert.equal(
    effectivePermissions({
      level: 'owner',
      blocked: true,
      overrides: { assistant: 'deny' },
    }).length,
    8,
  );
  assert.equal(effectivePermissions({ level: 'admin' }).length, 8);
});
test('administration cannot promote self, modify admins, or modify configured owner', () => {
  const actor = { level: 'admin', blocked: false };
  assert.throws(
    () => protectTarget(actor, { level: 'member' }, { level: 'admin' }),
    { code: 'forbidden' },
  );
  assert.throws(() => protectTarget(actor, { level: 'admin' }, {}), {
    code: 'forbidden',
  });
  assert.throws(
    () => protectTarget({ level: 'owner' }, { level: 'owner' }, {}),
    { code: 'protected_owner' },
  );
  protectTarget({ level: 'owner' }, { level: 'admin' }, { level: 'member' });
});
test('closed fields reject owner and arbitrary privileges', () => {
  const base = {
    operationId: 'f53ec7aa-3016-4fea-a7c7-40ff112a2a61',
    revision: 1,
  };
  for (const extra of [
    { level: 'owner' },
    { userId: 'forged' },
    { overrides: { admin: 'allow' } },
    { email: 'unwanted' },
  ])
    assert.equal(
      schemas['user.update'].safeParse({ ...base, ...extra }).success,
      false,
    );
});
