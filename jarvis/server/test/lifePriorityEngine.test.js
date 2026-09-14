const test = require('node:test');
const assert = require('node:assert/strict');
const { PriorityEngine } = require('../src/life/priority/priorityEngine');

const USER = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-14T12:00:00.000Z');

function projects() {
  return [
    { id: A, name: 'A', status: 'active', updated_at: '2026-09-01T00:00:00.000Z' },
    { id: B, name: 'B', status: 'active', updated_at: '2026-09-14T10:00:00.000Z', target_at: '2026-09-15T12:00:00.000Z' },
  ];
}

test('valid pin overrides score, hidden projects are excluded, and calculations are owner-scoped', async () => {
  const writes = [];
  const engine = new PriorityEngine({ repository: { async saveCalculation(input) { writes.push(input); } }, now: () => NOW });
  const result = await engine.evaluate({
    userId: USER, projects: projects(), areas: [], commitments: [], events: [],
    states: [{ project_id: A, pinned: true }], mode: { mode: 'work' }, preferences: [],
    resourceAvailable: null,
  });
  assert.equal(result.selected.project.id, A);
  assert.equal(result.selectionReason, 'user_pin');
  assert.equal(writes.length, 2);
  assert.equal(writes.every((write) => write.userId === USER), true);

  const hidden = await engine.evaluate({
    userId: USER, projects: projects(), areas: [], commitments: [], events: [],
    states: [{ project_id: A, pinned: true, hidden_until: '2026-09-15T12:00:00.000Z' }],
    mode: { mode: 'work' }, preferences: [], resourceAvailable: null, persist: false,
  });
  assert.equal(hidden.selected.project.id, B);
  assert.equal(writes.length, 2);
});

test('fallback chooses eligible pin, then most recently active project, then none', () => {
  const engine = new PriorityEngine({ now: () => NOW });
  assert.equal(engine.fallback({ projects: projects(), states: [{ project_id: A, pinned: true }], now: NOW }).selected.id, A);
  assert.equal(engine.fallback({ projects: projects(), states: [], now: NOW }).selected.id, B);
  assert.equal(engine.fallback({ projects: [{ id: A, status: 'archived' }], states: [], now: NOW }).selected, null);
});
