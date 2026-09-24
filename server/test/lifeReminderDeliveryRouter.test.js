const test = require('node:test');
const assert = require('node:assert/strict');
const { ReminderDeliveryRouter } = require('../src/life/reminders/reminderDeliveryRouter');

const reminder = {
  id: '11111111-1111-4111-8111-111111111111', user_id: 'owner-a', title: 'Продолжить Life OS',
  occurrence_key: 'occurrence-a', origin_conversation_id: 'conversation-a', origin_device_id: 'device-a',
};

test('delivery router passes only authenticated stored destinations and the stable delivery key', async () => {
  const calls = [];
  const router = new ReminderDeliveryRouter({ telegram: { async deliver(input) { calls.push(input); return { status: 'delivered' }; } } });
  const result = await router.deliver({ reminder, channel: 'telegram', deliveryKey: 'delivery-a' });
  assert.equal(result.status, 'delivered');
  assert.deepEqual(calls[0], {
    userId: 'owner-a', conversationId: 'conversation-a', deviceId: null,
    title: 'Продолжить Life OS', reminderId: reminder.id,
    occurrenceKey: 'occurrence-a', deliveryKey: 'delivery-a',
  });
});

test('throws and malformed transport results become unknown instead of implied success', async () => {
  const throwing = new ReminderDeliveryRouter({ desktop: { async deliver() { throw new Error('socket lost'); } } });
  assert.equal((await throwing.deliver({ reminder, channel: 'desktop', deliveryKey: 'same-key' })).status, 'outcome_unknown');
  const malformed = new ReminderDeliveryRouter({ desktop: { async deliver() { return { ok: true }; } } });
  assert.equal((await malformed.deliver({ reminder, channel: 'desktop', deliveryKey: 'same-key' })).status, 'outcome_unknown');
});

test('missing reconciliation support preserves unknown outcome and never sends again', async () => {
  const router = new ReminderDeliveryRouter({ telegram: { async deliver() { return { status: 'delivered' }; } } });
  assert.deepEqual(await router.reconcile({ channel: 'telegram', deliveryKey: 'same-key' }), { status: 'outcome_unknown' });
});
