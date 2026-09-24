const test = require('node:test');
const assert = require('node:assert/strict');
const { CommitmentRepository } = require('../src/life/commitments/commitmentRepository');

const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const COMMITMENT = '33333333-3333-4333-8333-333333333333';

function pool() {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [{ id: COMMITMENT, revision: 1 }], rowCount: 1 }; } };
}

test('commitment creation is owner-scoped, ranged, and replay-idempotent', async () => {
  const db = pool();
  const repository = new CommitmentRepository(db);
  await repository.create({
    userId: USER, sourceEventId: EVENT, title: 'Продолжить Life OS',
    dueAt: '2026-09-15T15:00:00.000Z', dueWindowEndAt: '2026-09-15T19:00:00.000Z',
    recurrence: null, confidence: 0.9,
  });
  assert.match(db.calls[0].sql, /ON CONFLICT \(user_id, source_event_id\)/);
  assert.match(db.calls[0].sql, /life_events WHERE id = \$2 AND user_id = \$1/);
  assert.equal(db.calls[0].params[0], USER);
});

test('lifecycle lookup and verified workflow links always include owner scope', async () => {
  const db = pool();
  const repository = new CommitmentRepository(db);
  await repository.listRecent({ userId: USER, limit: 999 });
  await repository.transition({ userId: USER, commitmentId: COMMITMENT, revision: 1, status: 'completed' });
  await repository.isWorkflowLinked({ userId: USER, commitmentId: COMMITMENT, workflowId: EVENT });
  assert.deepEqual(db.calls[0].params, [USER, null, null, 50]);
  assert.match(db.calls[1].sql, /id = \$1 AND user_id = \$2 AND revision = \$3/);
  assert.match(db.calls[2].sql, /proposal\.user_id = \$1/);
  assert.match(db.calls[2].sql, /proposal\.commitment_id = \$2/);
  assert.match(db.calls[2].sql, /proposal\.workflow_id = \$3/);
  assert.match(db.calls[2].sql, /workflow\.status = 'succeeded'/);
});
