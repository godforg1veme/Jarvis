const test = require('node:test');
const assert = require('node:assert/strict');
const { ReminderRepository, occurrenceKey } = require('../src/life/reminders/reminderRepository');

const USER = '11111111-1111-4111-8111-111111111111';
const REMINDER = '22222222-2222-4222-8222-222222222222';
const DELIVERY = '33333333-3333-4333-8333-333333333333';

test('occurrence and delivery keys are stable and contain no reminder content', () => {
  const first = occurrenceKey('private-operation-key', '2026-09-15T15:00:00Z');
  assert.equal(first, occurrenceKey('private-operation-key', new Date('2026-09-15T15:00:00Z')));
  assert.match(first, /^reminder:[a-f0-9]{64}$/);
  assert.equal(first.includes('private-operation-key'), false);
});

test('delivery claims, results, acknowledgements, and reconciliation stay owner scoped', async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql: String(sql), params });
    return { rows: [{ id: DELIVERY, user_id: USER, state: 'sending' }], rowCount: 1 };
  } };
  const repository = new ReminderRepository(pool);
  await repository.beginDelivery({ userId: USER, reminderId: REMINDER, occurrenceKey: 'occurrence-a', channel: 'desktop', deliveryKey: 'delivery-a' });
  await repository.finishDelivery({ userId: USER, deliveryId: DELIVERY, deliveryKey: 'delivery-a', state: 'delivered' });
  await repository.acknowledge({ userId: USER, reminderId: REMINDER, revision: 2 });
  await repository.listUnknownDeliveries({ limit: 999 });
  await repository.reconcileDelivery({ userId: USER, deliveryId: DELIVERY, deliveryKey: 'delivery-a', state: 'delivered' });
  await repository.completeUnknown({ userId: USER, reminderId: REMINDER, revision: 3 });
  assert.match(calls[0].sql, /life_reminders WHERE id = \$2 AND user_id = \$1 AND occurrence_key = \$3/);
  assert.match(calls[1].sql, /id = \$1 AND user_id = \$2 AND delivery_key = \$3/);
  assert.match(calls[2].sql, /reminder\.id = \$1 AND reminder\.user_id = \$2 AND reminder\.revision = \$3/);
  assert.match(calls[3].sql, /JOIN life_reminders reminder[\s\S]*reminder\.user_id = delivery\.user_id/);
  assert.equal(calls[3].params[0], 50);
  assert.match(calls[4].sql, /id = \$1 AND user_id = \$2 AND delivery_key = \$3/);
  assert.match(calls[5].sql, /id = \$1 AND user_id = \$2 AND revision = \$3 AND state = 'outcome_unknown'/);
});

test('claiming is atomic, bounded, and cannot overflow the database attempt limit', async () => {
  const calls = [];
  const repository = new ReminderRepository({ async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [] }; } });
  await repository.claimDue({ now: '2026-09-15T15:00:00Z', limit: 500 });
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /attempt_count < 20/);
  assert.equal(calls[0].params[2], 50);
});
