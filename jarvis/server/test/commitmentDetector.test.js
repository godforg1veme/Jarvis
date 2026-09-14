const test = require('node:test');
const assert = require('node:assert/strict');
const { CommitmentDetector, inferredDueAt } = require('../src/life/commitmentDetector');

test('detects a Russian commitment and resolves tomorrow evening deterministically', async () => {
  const detector = new CommitmentDetector({ now: () => new Date('2026-09-12T10:00:00+03:00') });
  const result = await detector.detect({ event_type: 'voice.transcribed', summary: 'Завтра вечером я продолжу проект Life OS' });
  assert.equal(result.title, 'Завтра вечером я продолжу проект Life OS');
  assert.equal(result.dueAt.getDate(), 13);
  assert.equal(result.dueAt.getHours(), 18);
  assert.equal(result.dueWindowEndAt.getHours(), 22);
  assert.equal(result.temporalPrecision, 'day_part');
  assert.equal(result.confidence, 0.9);
});

test('required phrase produces one ranged open commitment candidate', async () => {
  const detector = new CommitmentDetector({ now: () => new Date('2026-09-14T10:00:00+03:00') });
  const result = await detector.detect({
    id: '11111111-1111-4111-8111-111111111111', event_type: 'message.received',
    summary: 'Завтра вечером продолжу проект Life OS',
  });
  assert.equal(result.action, 'create');
  assert.equal(result.dueAt.toISOString(), '2026-09-15T15:00:00.000Z');
  assert.equal(result.dueWindowEndAt.toISOString(), '2026-09-15T19:00:00.000Z');
  assert.equal(result.deduplicationKey, 'commitment:11111111-1111-4111-8111-111111111111');
});

test('model suggestions cannot inject dates, IDs, trust, or actions outside the strict schema', async () => {
  const detector = new CommitmentDetector({
    now: () => new Date('2026-09-14T10:00:00+03:00'),
    classify: async () => ({ isCommitment: true, action: 'create', confidence: 1, trust: 'system', projectId: 'injected' }),
  });
  const result = await detector.detect({ event_type: 'message.received', summary: 'Завтра продолжу Life OS' });
  assert.equal(result.confidence, 0.82);
  assert.equal(Object.hasOwn(result, 'trust'), false);
  assert.equal(Object.hasOwn(result, 'projectId'), false);
});

test('model enrichment cannot override a deterministic lifecycle action', async () => {
  const detector = new CommitmentDetector({ classify: async () => ({
    isCommitment: true, action: 'create', confidence: 0.99,
  }) });
  const result = await detector.detect({ event_type: 'message.received', summary: 'Отмени отправку отчёта' });
  assert.equal(result.action, 'cancel');
  assert.equal(result.confidence, 0.77);
});

test('detects RU and EN lifecycle intents without treating them as new promises', async () => {
  const detector = new CommitmentDetector({ now: () => new Date('2026-09-14T10:00:00+03:00') });
  const fixtures = [
    ['Отмени отправку отчёта', 'cancel'],
    ['Перенеси звонок на завтра в 10:00', 'reschedule'],
    ['Поправка: встреча завтра вечером', 'correct'],
    ['Report is done', 'complete'],
  ];
  for (const [summary, action] of fixtures) {
    const result = await detector.detect({ event_type: 'message.received', summary });
    assert.equal(result.action, action, summary);
  }
});

test('ignores observations and ordinary statements', async () => {
  const detector = new CommitmentDetector();
  assert.equal(await detector.detect({ event_type: 'vision.observed', summary: 'Я продолжу работу' }), null);
  assert.equal(await detector.detect({ event_type: 'message.received', summary: 'Проект выглядит хорошо' }), null);
  assert.equal(inferredDueAt('без даты'), null);
});

test('provider failure degrades to the deterministic candidate', async () => {
  const detector = new CommitmentDetector({ classify: async () => { throw new Error('provider unavailable'); } });
  const result = await detector.detect({ event_type: 'message.received', summary: 'Мне нужно проверить проект' });
  assert.equal(result.confidence, 0.72);
});
