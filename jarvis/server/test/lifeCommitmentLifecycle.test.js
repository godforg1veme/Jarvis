const test = require('node:test');
const assert = require('node:assert/strict');
const { CommitmentLifecycleService } = require('../src/life/commitments/commitmentLifecycleService');

const USER = '11111111-1111-4111-8111-111111111111';
const COMMITMENT = '22222222-2222-4222-8222-222222222222';
const WORKFLOW = '33333333-3333-4333-8333-333333333333';

test('explicit completion updates only an owner-scoped commitment', async () => {
  const calls = [];
  const service = new CommitmentLifecycleService({ repository: {
    async get(input) { calls.push(input); return { id: COMMITMENT, title: 'Отправить отчёт', revision: 2 }; },
    async transition(input) { calls.push(input); return { id: COMMITMENT, status: input.status, revision: 3 }; },
  } });
  const result = await service.apply({
    userId: USER,
    event: { id: WORKFLOW, summary: 'Готово', structured_data: { commitmentId: COMMITMENT } },
    detected: { action: 'complete', title: 'Готово' },
  });
  assert.equal(result.commitment.status, 'completed');
  assert.equal(calls.every((call) => call.userId === USER), true);
});

test('ambiguous recent candidates require clarification', async () => {
  const service = new CommitmentLifecycleService({ repository: {
    async listRecent() { return [
      { id: COMMITMENT, title: 'Отправить отчёт', revision: 1 },
      { id: WORKFLOW, title: 'Отправить отчёт', revision: 1 },
    ]; },
  } });
  const result = await service.apply({ userId: USER, event: { summary: 'Отмени отправить отчёт' }, detected: { action: 'cancel' } });
  assert.equal(result.status, 'needs_clarification');
});

test('an inaccessible explicit id never falls back to a similarly titled commitment', async () => {
  let listed = false;
  const service = new CommitmentLifecycleService({ repository: {
    async get() { return null; },
    async listRecent() { listed = true; return [{ id: COMMITMENT, title: 'Отправить отчёт', revision: 1 }]; },
  } });
  const result = await service.apply({
    userId: USER,
    event: { summary: 'Отмени отправить отчёт', structured_data: { commitmentId: WORKFLOW } },
    detected: { action: 'cancel' },
  });
  assert.equal(result.status, 'needs_clarification');
  assert.equal(listed, false);
});

test('reschedule without a new date requests clarification and does not mutate projection', async () => {
  let transitioned = false;
  const service = new CommitmentLifecycleService({ repository: {
    async get() { return { id: COMMITMENT, title: 'Позвонить', revision: 1 }; },
    async transition() { transitioned = true; },
  } });
  const result = await service.apply({
    userId: USER,
    event: { summary: 'Перенеси звонок', structured_data: { commitmentId: COMMITMENT } },
    detected: { action: 'reschedule', dueAt: null },
  });
  assert.equal(result.status, 'needs_clarification');
  assert.equal(transitioned, false);
});

test('correction appends a lifecycle event while preserving the source event', async () => {
  const records = [];
  const sourceEvent = { id: WORKFLOW, summary: 'Поправка: звонок завтра в 10', structured_data: { commitmentId: COMMITMENT } };
  const before = JSON.stringify(sourceEvent);
  const service = new CommitmentLifecycleService({
    repository: {
      async get() { return { id: COMMITMENT, title: 'Позвонить вечером', revision: 1 }; },
      async transition(input) { return { id: COMMITMENT, title: input.title, status: input.status, revision: 2 }; },
    },
    gateway: { async record(input) { records.push(input); } },
  });
  const result = await service.apply({
    userId: USER, event: sourceEvent,
    detected: { action: 'correct', title: 'Позвонить завтра в 10', dueAt: new Date('2026-09-15T07:00:00Z') },
  });
  assert.equal(result.status, 'updated');
  assert.equal(records.length, 1);
  assert.equal(records[0].structuredData.sourceEventId, WORKFLOW);
  assert.equal(JSON.stringify(sourceEvent), before);
});

test('verified workflow completion requires an existing owner-scoped commitment link', async () => {
  let transitions = 0;
  const repository = {
    async isWorkflowLinked({ userId, commitmentId, workflowId }) { return userId === USER && commitmentId === COMMITMENT && workflowId === WORKFLOW; },
    async transition() { transitions += 1; return { id: COMMITMENT, status: 'completed' }; },
  };
  const service = new CommitmentLifecycleService({ repository });
  assert.equal(await service.completeFromVerifiedAction({ userId: USER, commitmentId: COMMITMENT, revision: 1, workflowId: '44444444-4444-4444-8444-444444444444' }), null);
  assert.ok(await service.completeFromVerifiedAction({ userId: USER, commitmentId: COMMITMENT, revision: 1, workflowId: WORKFLOW }));
  assert.equal(transitions, 1);
});
