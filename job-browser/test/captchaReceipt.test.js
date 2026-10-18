const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validReceipt, redirectKind } = require('../src/captchaReceipt');
const { initial, validate } = require('../src/manualState');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { CaptchaTelegramBrowser } = require('../src/captchaTelegramBrowser');
const receipt = () => ({ operationHash: 'a'.repeat(64), startedAt: 100, stage: 'finished', received: true,
  permitted: 1, httpStatus: 302, redirect: 'captcha', verification: 'captcha', verificationStatus: 200,
  view: 'captcha', visibleError: 'none', outcome: 'unknown' });
test('redirect diagnostics contain categories only and never forward a location', () => {
  const base = 'https://hh.ru/account/captcha';
  assert.equal(redirectKind('/account/captcha?state=private', base), 'captcha');
  assert.equal(redirectKind('/vacancy/123', base), 'same_origin');
  assert.equal(redirectKind('https://evil.example/?token=private', base), 'external');
  assert.equal(redirectKind('https://user@hh.ru/vacancy/123', base), 'external');
  assert.equal(redirectKind('https://[invalid', base), 'invalid');
  assert.equal(redirectKind(undefined, base), 'none');
});
test('receipt validation rejects raw content and invalid status/stage/scope', () => {
  const ownerId = randomUUID(), state = { ...initial(ownerId), lastReceipt: receipt() };
  assert.ok(validate(state, ownerId));
  for (const patch of [{ text: 'private' }, { url: 'https://hh.ru' }, { httpStatus: 999 }, { verification: 'private' },
    { stage: 'private' }, { outcome: 'private' }, { permitted: 2 }, { received: 'yes' }, { startedAt: -1 }]) {
    assert.ok(!validReceipt({ ...receipt(), ...patch }));
    assert.throws(() => validate({ ...state, lastReceipt: { ...receipt(), ...patch } }, ownerId));
  }
  assert.throws(() => validate(state, randomUUID()));
});
test('receipt persists through interrupted checking and successful recovery without altering claims', async () => {
  const ownerId = randomUUID(); let saved = { ...initial(ownerId), phase: 'checking', recoveryId: randomUUID(),
    target: 'https://hh.ru/vacancy/123', claims: ['b'.repeat(64)], lastReceipt: { ...receipt(), stage: 'response', outcome: 'pending' } };
  const m = new ManualCoordinator({ store: { read: async () => structuredClone(saved),
    write: async value => (saved = structuredClone(validate(value, ownerId))) }, verify: async () => true });
  await m.load(); assert.equal(saved.phase, 'active'); assert.equal(saved.lastReceipt.stage, 'response');
  assert.deepEqual(saved.claims, ['b'.repeat(64)]);
  await m.finish(saved.revision); assert.equal(saved.phase, 'idle'); assert.ok(saved.lastReceipt);
});

test('failed prepared receipt prevents claiming or dispatching the human answer', async () => {
  let claims = 0, dispatches = 0;
  const form = { action: 'https://hh.ru/account/captcha', method: 'post', enctype: 'application/x-www-form-urlencoded',
    inputs: [{ name: '_xsrf', value: 'fixture' }, { name: 'isBot', value: 'false' }] };
  const coordinator = { state: { claims: [] }, status: () => ({ phase: 'active', revision: 1 }),
    write: async () => { throw Error('private'); }, claimMany: async () => { claims++; } };
  const c = new CaptchaTelegramBrowser({ coordinator, dispatch: async () => { dispatches++; } });
  c.current = { key: 'fixture', challengeId: randomUUID(), revision: 1, expires: Date.now() + 60000,
    target: 'https://hh.ru/vacancy/123', form };
  c.page = { isClosed: () => false, locator: () => ({ fill: async () => {} }) };
  c.picture = async () => ({ key: 'fixture', target: c.current.target, form });
  await assert.rejects(c.submitAnswer({ challengeId: c.current.challengeId, revision: 1,
    operationId: randomUUID(), text: 'проверка картинки' }));
  assert.equal(claims, 0); assert.equal(dispatches, 0);
});
