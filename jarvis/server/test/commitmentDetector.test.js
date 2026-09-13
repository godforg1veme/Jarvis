const test = require('node:test');
const assert = require('node:assert/strict');
const { CommitmentDetector, inferredDueAt } = require('../src/life/commitmentDetector');

test('detects a Russian commitment and resolves tomorrow evening deterministically', async () => {
  const detector = new CommitmentDetector({ now: () => new Date('2026-09-12T10:00:00+03:00') });
  const result = await detector.detect({ event_type: 'voice.transcribed', summary: 'Завтра вечером я продолжу проект Life OS' });
  assert.equal(result.title, 'Завтра вечером я продолжу проект Life OS');
  assert.equal(result.dueAt.getDate(), 13);
  assert.equal(result.dueAt.getHours(), 19);
  assert.equal(result.confidence, 0.9);
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
