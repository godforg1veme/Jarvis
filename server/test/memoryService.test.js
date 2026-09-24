const assert = require('node:assert/strict');
const test = require('node:test');
const { MemoryService, containsSensitiveMemoryData, inferUsefulFact, parseMemoryCommand } = require('../src/memory/memoryService');

function harness() {
  const state = { memories: [], versions: [] };
  const repository = {
    async listActive() { return state.memories.filter((memory) => memory.active !== false); },
    async create(input) {
      const memory = { id: `memory-${state.memories.length + 1}`, active: true, ...input };
      state.memories.push(memory);
      state.versions.push({ memoryId: memory.id, reason: input.changeReason });
      return memory;
    },
    async deactivateMatching({ query }) {
      const lowered = query.toLowerCase();
      const matches = state.memories.filter((memory) => memory.active !== false && memory.content.toLowerCase().includes(lowered));
      matches.forEach((memory) => { memory.active = false; });
      return matches;
    },
    async deactivateById({ memoryId }) {
      const memory = state.memories.find((item) => item.id === memoryId && item.active !== false);
      if (memory) memory.active = false;
      return memory || null;
    },
    async replaceById({ memoryId, content, kind, sourceConversationId }) {
      const previous = state.memories.find((item) => item.id === memoryId && item.active !== false);
      if (!previous) return null;
      previous.active = false;
      const memory = { id: `memory-${state.memories.length + 1}`, active: true, content, kind, sourceConversationId };
      state.memories.push(memory);
      return memory;
    },
  };
  return { service: new MemoryService({ repository }), state };
}

test('never stores passwords, tokens, or payment data', async () => {
  const { service, state } = harness();
  const result = await service.handleUserText({ userId: 'user-a', text: 'запомни мой пароль qwerty' });
  assert.match(result.answer, /не сохраняю/i);
  assert.equal(state.memories.length, 0);
  assert.equal(containsSensitiveMemoryData('карта 4111 1111 1111 1111'), true);
});

test('manual correction deactivates old facts before adding the new one', async () => {
  const { service, state } = harness();
  await service.handleUserText({ userId: 'user-a', text: 'запомни я живу в Казани' });
  const result = await service.handleUserText({ userId: 'user-a', text: 'исправь Казани → я живу в Самаре' });
  assert.match(result.answer, /Исправил/);
  assert.equal(state.memories[0].active, false);
  assert.equal(state.memories[1].content, 'я живу в Самаре');
});

test('automatically captures only high-confidence facts', async () => {
  const { service, state } = harness();
  await service.handleUserText({ userId: 'user-a', text: 'Я живу в Омске' });
  await service.handleUserText({ userId: 'user-a', text: 'Как там погода?' });
  assert.equal(state.memories.length, 1);
  assert.equal(state.memories[0].content, 'Я живу в Омске');
  assert.deepEqual(inferUsefulFact('мой token abc'), null);
});

test('parses Russian memory commands', () => {
  assert.deepEqual(parseMemoryCommand('что ты обо мне помнишь'), { type: 'list' });
  assert.deepEqual(parseMemoryCommand('исправь старое -> новое'), { type: 'correct', query: 'старое', content: 'новое' });
});

test('button-facing memory methods stay owner-scoped through repository IDs and reject secrets', async () => {
  const { service, state } = harness();
  const created = await service.remember({ userId: 'user-a', content: 'Я люблю чай' });
  assert.equal(created.ok, true);
  assert.equal((await service.remember({ userId: 'user-a', content: 'мой токен abc' })).ok, false);
  const corrected = await service.correctById({ userId: 'user-a', memoryId: state.memories[0].id, content: 'Я люблю кофе' });
  assert.equal(corrected.ok, true);
  assert.equal(state.memories[0].active, false);
  assert.equal((await service.forgetById({ userId: 'user-a', memoryId: corrected.memory.id })).ok, true);
});
