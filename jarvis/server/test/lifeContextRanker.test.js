const test = require('node:test');
const assert = require('node:assert/strict');
const { rankLifeCandidates } = require('../src/life/context/lifeContextRanker');

const NOW = new Date('2026-09-14T12:00:00.000Z');

test('ranker keeps direct, continuation, and urgent context while dropping unrelated noise', () => {
  const ranked = rankLifeCandidates({
    query: 'Как лучше продолжить проект Life OS?',
    now: NOW,
    selectedProjectId: 'project-life',
    candidates: [
      { kind: 'project', id: 'project-life', projectId: 'project-life', title: 'Life OS', summary: 'Контекстный Jarvis', confidence: 1, trust: 'user', occurredAt: '2026-09-14T10:00:00.000Z', pinned: true },
      { kind: 'commitment', id: 'c1', projectId: 'project-life', title: 'Продолжить Life OS', dueAt: '2026-09-15T15:00:00.000Z', confidence: 0.95, trust: 'inferred' },
      { kind: 'event', id: 'e-noise', title: 'Замена фильтра воды', summary: 'Домашнее обслуживание', confidence: 1, trust: 'trusted', occurredAt: '2026-09-14T11:30:00.000Z' },
    ],
  });
  assert.deepEqual(ranked.items.map((item) => item.kind), ['project', 'commitment']);
  assert.equal(ranked.items.some((item) => 'id' in item || 'projectId' in item), false);
  assert.ok(ranked.totalCharacters <= 6000);
});

test('ranker admits a near-term commitment but does not inject a merely recent unrelated event', () => {
  const ranked = rankLifeCandidates({
    query: 'Расскажи короткий факт про космос',
    now: NOW,
    candidates: [
      { kind: 'commitment', title: 'Встреча с Анной', dueAt: '2026-09-14T18:00:00.000Z', confidence: 1, trust: 'user' },
      { kind: 'event', title: 'Покупка продуктов', occurredAt: '2026-09-14T11:50:00.000Z', confidence: 1, trust: 'trusted' },
    ],
  });
  assert.deepEqual(ranked.items.map((item) => item.title), ['Встреча с Анной']);
});

test('ranker applies deterministic category and character budgets', () => {
  const candidates = Array.from({ length: 30 }, (_, index) => ({
    kind: 'commitment', title: `Life OS задача ${index}`, summary: 'x'.repeat(1000),
    dueAt: `2026-09-15T${String(index % 24).padStart(2, '0')}:00:00.000Z`, confidence: 1, trust: 'user',
  }));
  const first = rankLifeCandidates({ query: 'Life OS задачи', now: NOW, candidates, maxItems: 20, maxCharacters: 1400 });
  const second = rankLifeCandidates({ query: 'Life OS задачи', now: NOW, candidates, maxItems: 20, maxCharacters: 1400 });
  assert.deepEqual(first, second);
  assert.ok(first.items.length <= 5);
  assert.ok(first.totalCharacters <= 1400);
});
