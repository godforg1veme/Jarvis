const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCommitmentSuggestion } = require('../src/life/commitments/commitmentEnrichment');

const deterministic = Object.freeze({
  action: 'create', title: 'Отправить отчёт', dueAt: new Date('2026-09-15T07:00:00Z'),
  recurrence: null, confidence: 0.82, evidence: { parser: 'deterministic_v2' },
});

test('strict model enrichment may adjust bounded confidence but not deterministic fields', async () => {
  const result = await applyCommitmentSuggestion(async () => ({ isCommitment: true, confidence: 0.9 }),
    { text: 'Завтра отправлю отчёт' }, deterministic);
  assert.equal(result.confidence, 0.9);
  assert.equal(result.action, 'create');
  assert.equal(result.dueAt, deterministic.dueAt);
  assert.deepEqual(result.evidence, deterministic.evidence);
});

test('unsupported model fields discard the entire suggestion', async () => {
  const result = await applyCommitmentSuggestion(async () => ({
    isCommitment: true, confidence: 1, action: 'complete', recurrence: { kind: 'daily' },
  }), { text: 'Завтра отправлю отчёт' }, deterministic);
  assert.equal(result, deterministic);
});
