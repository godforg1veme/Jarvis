const test = require('node:test');
const assert = require('node:assert/strict');
const { ReminderService } = require('../src/life/reminders/reminderService');

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const REMINDER = '44444444-4444-4444-8444-444444444444';

test('create derives destination and idempotency from authenticated origin, not reminder text', async () => {
  const calls = [];
  const service = new ReminderService({ repository: { async create(input) { calls.push(input); return { id: REMINDER, state: 'scheduled', revision: 1 }; } } });
  const row = await service.create({
    userId: USER, origin: { channel: 'desktop', deviceId: DEVICE },
    input: { requestId: REQUEST, title: 'Напомни; device=attacker', triggerAt: '2026-09-15T15:00:00Z', timezone: 'Europe/Moscow', deliveryChannels: ['desktop'] },
  });
  assert.equal(row.id, REMINDER);
  assert.equal(calls[0].originDeviceId, DEVICE);
  assert.equal(calls[0].originConversationId, null);
  assert.match(calls[0].idempotencyKey, /^reminder:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(calls[0], 'requestId'), false);
});

test('cross-channel delivery requires a destination established by authenticated context', async () => {
  const service = new ReminderService({ repository: { async create() { throw new Error('must not write'); } } });
  await assert.rejects(service.create({
    userId: USER, origin: { channel: 'desktop', deviceId: DEVICE },
    input: { requestId: REQUEST, title: 'Напомнить', triggerAt: '2026-09-15T15:00:00Z', timezone: 'UTC', deliveryChannels: ['telegram'] },
  }));
});

test('invalid timezone and expiry before trigger are rejected before persistence', async () => {
  let writes = 0;
  const service = new ReminderService({ repository: { async create() { writes += 1; } } });
  const common = { requestId: REQUEST, title: 'Напомнить', triggerAt: '2026-09-15T15:00:00Z', deliveryChannels: ['desktop'] };
  await assert.rejects(service.create({ userId: USER, origin: { channel: 'desktop', deviceId: DEVICE }, input: { ...common, timezone: 'Mars/Olympus' } }));
  await assert.rejects(service.create({ userId: USER, origin: { channel: 'desktop', deviceId: DEVICE }, input: { ...common, timezone: 'UTC', expiresAt: '2026-09-15T14:00:00Z' } }));
  assert.equal(writes, 0);
});

test('reschedule, cancel, and acknowledge remain owner and revision scoped', async () => {
  const calls = [];
  const repository = {
    async update(input) { calls.push(input); return { id: REMINDER, state: input.state || 'scheduled', revision: 2 }; },
    async acknowledge(input) { calls.push(input); return { id: REMINDER, state: 'acknowledged', revision: 3 }; },
  };
  const service = new ReminderService({ repository });
  await service.reschedule({ userId: USER, reminderId: REMINDER, revision: 1, triggerAt: '2026-09-16T10:00:00Z' });
  await service.cancel({ userId: USER, reminderId: REMINDER, revision: 2 });
  await service.acknowledge({ userId: USER, reminderId: REMINDER, revision: 2 });
  assert.equal(calls.every((call) => call.userId === USER && call.reminderId === REMINDER), true);
  assert.deepEqual(calls.map((call) => call.revision), [1, 2, 2]);
});
