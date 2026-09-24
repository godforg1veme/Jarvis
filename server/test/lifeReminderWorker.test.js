const test = require('node:test');
const assert = require('node:assert/strict');
const { ReminderWorker, deliveryKey, quietEnd } = require('../src/life/reminders/reminderWorker');
const { nextOccurrence } = require('../src/life/reminders/nextOccurrence');

const NOW = new Date('2026-03-08T13:00:00Z');
const base = {
  id: '11111111-1111-4111-8111-111111111111', user_id: 'owner-a', title: 'Проверить проект',
  trigger_at: new Date('2026-03-08T13:00:00Z'), timezone: 'America/New_York',
  recurrence: null, delivery_channels: ['telegram'], occurrence_key: 'occurrence-a',
  idempotency_key: 'reminder-a', attempt_count: 1, origin_conversation_id: 'conversation-a',
};

function repositoryFixture(reminder = { ...base }) {
  const transitions = []; const deliveries = new Map(); let completed = null;
  return {
    transitions, deliveries, get completed() { return completed; },
    async markStaleClaimsUnknown() { return []; },
    async listUnknownDeliveries() { return []; },
    async claimDue() { return { claimToken: 'claim-a', reminders: [reminder] }; },
    async countDeliveredSince() { return 0; },
    async beginDelivery(input) {
      const existing = deliveries.get(input.deliveryKey);
      if (existing) return { ...existing, canSend: false };
      const row = { id: 'delivery-a', state: 'sending', attempt_count: 1, ...input, canSend: true };
      deliveries.set(input.deliveryKey, row); return row;
    },
    async retryDelivery(input) { const row = { ...deliveries.get(input.deliveryKey), state: 'sending', canSend: true }; deliveries.set(input.deliveryKey, row); return row; },
    async finishDelivery(input) { const row = { ...deliveries.get(input.deliveryKey), state: input.state, error_code: input.errorCode }; deliveries.set(input.deliveryKey, row); return row; },
    async completeClaim(input) { completed = input; return { ...reminder, state: input.nextTriggerAt ? 'scheduled' : 'delivered' }; },
    async transitionClaim(input) { transitions.push(input); return { ...reminder, state: input.state }; },
  };
}

test('recurrence preserves local wall time across DST and supported schedule families', () => {
  const daily = nextOccurrence(new Date('2026-03-07T14:00:00Z'), { kind: 'daily', interval: 1 }, 'America/New_York');
  assert.equal(daily.toISOString(), '2026-03-08T13:00:00.000Z');
  assert.equal(nextOccurrence('2026-09-18T07:00:00Z', { kind: 'weekdays', weekdays: [1, 2, 3, 4, 5] }, 'Europe/Moscow').toISOString(), '2026-09-21T07:00:00.000Z');
  assert.equal(nextOccurrence('2026-01-31T09:00:00Z', { kind: 'monthly_date', day: 31, interval: 1 }, 'UTC').toISOString(), '2026-02-28T09:00:00.000Z');
});

test('one occurrence is delivered once and recurring completion is committed atomically', async () => {
  const reminder = { ...base, recurrence: { kind: 'daily', interval: 1 } };
  const repository = repositoryFixture(reminder); let sends = 0;
  const worker = new ReminderWorker({ repository, router: { async deliver() { sends += 1; return { status: 'delivered' }; } }, now: () => NOW });
  await worker.tick();
  assert.equal(sends, 1);
  assert.equal(repository.completed.nextTriggerAt.toISOString(), '2026-03-09T13:00:00.000Z');
  assert.match(repository.completed.nextOccurrenceKey, /^reminder:[a-f0-9]{64}$/);
  await worker._process(reminder, 'claim-b', NOW);
  assert.equal(sends, 1, 'persisted delivery key prevents a duplicate external send');
});

test('ambiguous transport outcome is persisted and never blindly retried', async () => {
  const repository = repositoryFixture(); let sends = 0;
  const worker = new ReminderWorker({ repository, router: { async deliver() { sends += 1; return { status: 'outcome_unknown' }; } }, now: () => NOW });
  await worker.tick();
  assert.equal(repository.transitions.at(-1).state, 'outcome_unknown');
  await worker._process(base, 'claim-b', NOW);
  assert.equal(sends, 1);
  assert.equal(repository.transitions.at(-1).state, 'outcome_unknown');
});

test('unknown outcome is reconciled under the original delivery key without another send', async () => {
  const repository = repositoryFixture(); let sends = 0; let reconciledKey = null;
  const unknown = {
    id: 'delivery-a', user_id: base.user_id, reminder_id: base.id, occurrence_key: base.occurrence_key,
    channel: 'telegram', delivery_key: deliveryKey(base, 'telegram'), state: 'outcome_unknown',
    title: base.title, timezone: base.timezone, recurrence: null, trigger_at: base.trigger_at,
    idempotency_key: base.idempotency_key, delivery_channels: ['telegram'], reminder_revision: 3,
  };
  repository.listUnknownDeliveries = async () => [unknown];
  repository.reconcileDelivery = async (input) => { reconciledKey = input.deliveryKey; return { state: input.state }; };
  repository.occurrenceDelivered = async () => true;
  repository.completeUnknown = async (input) => { repository.completedUnknown = input; return { state: 'delivered' }; };
  repository.claimDue = async () => ({ claimToken: 'claim-a', reminders: [] });
  const worker = new ReminderWorker({
    repository,
    router: {
      async deliver() { sends += 1; return { status: 'delivered' }; },
      async reconcile({ deliveryKey: key }) { assert.equal(key, unknown.delivery_key); return { status: 'delivered' }; },
    }, now: () => NOW,
  });
  await worker.tick();
  assert.equal(sends, 0);
  assert.equal(reconciledKey, unknown.delivery_key);
  assert.equal(repository.completedUnknown.reminderId, base.id);
});

test('expired reminders terminate without calling any transport', async () => {
  const repository = repositoryFixture({ ...base, expires_at: new Date(NOW.getTime() - 1) }); let sends = 0;
  const worker = new ReminderWorker({ repository, router: { async deliver() { sends += 1; } }, now: () => NOW });
  await worker.tick();
  assert.equal(sends, 0);
  assert.equal(repository.transitions[0].state, 'expired');
});

test('quiet hours, mode policy, and daily owner cap defer without delivery', async () => {
  assert.equal(quietEnd(new Date('2026-09-14T20:00:00Z'), { startMinutes: 1320, endMinutes: 480, timezone: 'Europe/Moscow' }).toISOString(), '2026-09-15T05:00:00.000Z');
  const repository = repositoryFixture(); let sends = 0;
  const worker = new ReminderWorker({
    repository, router: { async deliver() { sends += 1; } }, now: () => new Date('2026-09-14T20:00:00Z'),
    policyProvider: async () => ({ quietHours: { startMinutes: 1320, endMinutes: 480, timezone: 'Europe/Moscow' } }),
  });
  await worker.tick();
  assert.equal(sends, 0);
  assert.equal(repository.transitions[0].state, 'scheduled');
  assert.equal(repository.transitions[0].nextAttemptAt.toISOString(), '2026-09-15T05:00:00.000Z');

  const capped = repositoryFixture(); capped.countDeliveredSince = async () => 5;
  const capWorker = new ReminderWorker({ repository: capped, router: { async deliver() { sends += 1; } }, now: () => NOW, policyProvider: async () => ({ maxPerDay: 5 }) });
  await capWorker.tick();
  assert.equal(capped.transitions[0].state, 'scheduled');
  assert.equal(sends, 0);
});

test('worker prevents overlapping claims and uses a deterministic transport key', async () => {
  let release;
  const repository = repositoryFixture();
  repository.claimDue = async () => new Promise((resolve) => { release = () => resolve({ claimToken: 'claim-a', reminders: [] }); });
  const worker = new ReminderWorker({ repository, router: {} });
  const first = worker.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await worker.tick(), false);
  release(); await first;
  assert.equal(deliveryKey(base, 'telegram'), deliveryKey(base, 'telegram'));
});
