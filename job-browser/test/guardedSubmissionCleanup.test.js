const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { GuardedSubmission } = require('../src/guardedSubmission');
const { HhApplicationDriver } = require('../src/hhApplicationDriver');

test('reconciled sent proof is durable before cleanup health escalation', async () => {
  const ownerId = randomUUID(), operationId = randomUUID();
  const input = { userId: ownerId, operationId, externalId: '123', resumeId: 'resume1', letter: 'Fixture letter' };
  const order = [];
  const driver = { readResult: async () => { order.push('proof'); return { outcome: 'sent', verified: true, externalId: '456' }; },
    finishReadResultCleanup: () => order.push('unhealthy') };
  const ledger = { lookup: async () => ({ outcome: 'unknown' }), hasClaim: async () => true,
    finish: async (_identity, result) => { order.push('durable'); return result; } };
  const guarded = new GuardedSubmission({ ledger, driver, ownerId, primaryResumeId: 'resume1' });
  const result = await guarded.reconcile(input);
  assert.equal(result.outcome, 'sent');
  assert.deepEqual(order, ['proof', 'durable', 'unhealthy']);
});

test('failed durable checkpoint remains unknown and cleanup still escalates', async () => {
  const ownerId = randomUUID();
  const order = [];
  const guarded = new GuardedSubmission({ ownerId, primaryResumeId: 'resume1',
    driver: { readResult: async () => ({ outcome: 'sent', verified: true }), finishReadResultCleanup: () => order.push('unhealthy') },
    ledger: { lookup: async () => ({ outcome: 'unknown' }), hasClaim: async () => true,
      finish: async () => { order.push('checkpoint_failed'); throw Error('private'); } } });
  assert.deepEqual(await guarded.reconcile({ userId: ownerId, operationId: randomUUID(), externalId: '123', resumeId: 'resume1', letter: 'Fixture' }),
    { outcome: 'unknown' });
  assert.deepEqual(order, ['checkpoint_failed', 'unhealthy']);
});

test('driver defers cleanup health signal until the guarded caller invokes its hook', async () => {
  let closed = false, unhealthy = 0;
  const page = { url: () => 'https://hh.ru/vacancy/other', isClosed: () => false,
    goto: async () => { throw Error('private'); }, close: async () => { closed = true; } };
  const browser = { open: async () => ({ page }), onTimeout: () => { unhealthy++; } };
  const driver = new HhApplicationDriver({ browser });
  const result = await driver.readResult({ externalId: '123', resumeId: 'resume1', letter: 'Fixture' });
  assert.equal(result.outcome, 'unknown');
  assert.equal(closed, false); assert.equal(unhealthy, 0);
  driver.finishReadResultCleanup(); driver.finishReadResultCleanup();
  assert.equal(unhealthy, 1);
});
