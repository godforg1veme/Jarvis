const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { handoverCaptcha } = require('../src/browserMain');
test('fresh human handover has no unknown baseline; legacy attempts import their original ID and claims', async () => {
  const ownerId = randomUUID(), target = 'https://hh.ru/vacancy/123'; let saved = null, pending;
  const journal = { read: async () => saved, write: async value => (saved = value) };
  const manual = { pending: async value => { pending = value; } };
  const id = await handoverCaptcha({ journal, manual, ownerId, target, error: {}, now: () => 2000000000000 });
  assert.equal(pending.seedRequired, false); assert.deepEqual(pending.claims, []); assert.equal(pending.recoveryId, id);
  saved = { ...saved, phase: 'attempted' };
  assert.equal(await handoverCaptcha({ journal, manual, ownerId, target, error: {} }), id);
  assert.equal(pending.seedRequired, true);
  saved = { ...saved, challengeHash: 'a'.repeat(64) };
  await handoverCaptcha({ journal, manual, ownerId, target, error: {} });
  assert.equal(pending.seedRequired, false); assert.deepEqual(pending.claims, ['a'.repeat(64)]);
  await assert.rejects(handoverCaptcha({ journal, manual, ownerId, target, error: { recoveryId: randomUUID() } }), /JOB_MANUAL_STATE_DENIED/);
  await assert.rejects(handoverCaptcha({ journal, manual, ownerId, target: 'https://hh.ru/vacancy/124', error: {} }), /JOB_MANUAL_STATE_DENIED/);
});
