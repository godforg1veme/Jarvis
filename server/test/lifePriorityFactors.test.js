const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProjectPriority } = require('../src/life/priority/priorityFactors');

const NOW = new Date('2026-09-14T12:00:00.000Z');

test('priority factors have exact capped deterministic contributions', () => {
  const result = calculateProjectPriority({
    now: NOW,
    project: { target_at: '2026-09-15T12:00:00.000Z', updated_at: '2026-09-14T08:00:00.000Z' },
    state: { user_weight: 0.5 }, area: { area_key: 'work' }, areaWeight: 0.4,
    commitments: [
      { status: 'open', due_at: '2026-09-14T10:00:00.000Z' },
      { status: 'open', due_at: '2026-09-16T10:00:00.000Z' },
    ],
    events: [{ event_type: 'workflow.failed', occurred_at: '2026-09-14T08:00:00.000Z' }],
    mode: 'work', calendarCompatible: true, resourceAvailable: true, evidenceConfidence: 0.8,
  });
  assert.equal(result.score, 95);
  assert.equal(result.confidence, 0.8);
  assert.deepEqual(result.factors.map((factor) => factor.code), [
    'user.weight', 'area.weight', 'deadline.today', 'commitments.open',
    'commitments.overdue', 'activity.today', 'workflow.unresolved', 'mode.work',
    'calendar.window', 'resource.available', 'evidence.confidence',
  ]);
});

test('missing calendar and resource data add zero and lower confidence', () => {
  const result = calculateProjectPriority({
    now: NOW, project: {}, commitments: [], events: [], mode: 'work', evidenceConfidence: 1,
    calendarCompatible: null, resourceAvailable: null,
  });
  assert.equal(result.factors.some((factor) => factor.code === 'calendar.window'), false);
  assert.equal(result.factors.some((factor) => factor.code === 'resource.available'), false);
  assert.equal(result.confidence, 0.667);
});
