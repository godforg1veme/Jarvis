const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSearchService } = require('../src/search/webSearchService');
const { SearchIntentPlanner } = require('../src/search/searchIntentPlanner');
const { AssistantService } = require('../src/assistant/assistantService');

test('skip does not call Tavily', async () => {
  const service = new WebSearchService({ planner: { async plan() { return { mode: 'skip' }; } }, client: { async search() { throw new Error('called'); } } });
  assert.deepEqual(await service.prepare({ currentRequest: 'rewrite this' }), { status: 'skipped', sources: [] });
});

test('one public query is sent only after access check', async () => {
  let calls = 0;
  const service = new WebSearchService({ planner: { async plan() { return { mode: 'search', query: 'public docs' }; } },
    client: { async search({ query }) { calls++; assert.equal(query, 'public docs'); return { status: 'empty', sources: [] }; } } });
  assert.equal((await service.prepare({ currentRequest: 'search' })).status, 'empty');
  assert.equal(calls, 1);
  await assert.rejects(service.prepare({ currentRequest: 'search', requireAccess: async () => { throw new Error('denied'); } }));
  assert.equal(calls, 1);
});

test('planner only receives current request and validates strict output', async () => {
  const planner = new SearchIntentPlanner({ provider: { async answer(input) {
    assert.equal(input.messages.length, 2);
    assert.match(input.messages[1].content, /weather/);
    return '{"mode":"search","query":"Moscow weather today"}';
  } } });
  assert.deepEqual(await planner.plan({ currentRequest: 'Moscow weather' }), { mode: 'search', query: 'Moscow weather today' });
});

test('answer correction reuses the same search sources', async () => {
  let searches = 0;
  let generations = 0;
  const assistant = new AssistantService({
    profile: { provider: 'fixture', model: 'fixture', instructionMode: 'system' },
    provider: { async answer({ messages }) {
      generations++;
      assert.equal(messages.filter((item) => item.content.includes('JARVIS_UNTRUSTED_WEB_SOURCES_JSON')).length, 1);
      return generations === 1 ? 'Я — Gemini.' : 'Согласно [источнику](https://example.org/docs), данные опубликованы сегодня.';
    } },
    webSearchService: { async prepare() { searches++; return { status: 'ok', sources: [
      { id: 'W1', title: 'Docs', url: 'https://example.org/docs', excerpt: 'Today' },
    ] }; } },
  });
  const result = await assistant.answer({ currentRequest: 'Что нового?' });
  assert.match(result, /источнику/);
  assert.equal(searches, 1);
  assert.equal(generations, 2);
});

test('revoked access after MCP search prevents model answer', async () => {
  let checks = 0;
  let generations = 0;
  const assistant = new AssistantService({
    profile: { provider: 'fixture', model: 'fixture', instructionMode: 'system' },
    provider: { async answer() { generations++; return 'answer'; } },
    accessService: { async getAccessForUser() {
      checks++;
      return { blocked: checks > 3, permissions: ['assistant'] };
    } },
    webSearchService: { async prepare({ requireAccess }) { await requireAccess(); return { status: 'empty', sources: [] }; } },
  });
  await assert.rejects(assistant.answer({ userId: '100', currentRequest: 'latest news' }), /Access unavailable/);
  assert.equal(generations, 0);
});

test('failed search adds a server-owned disclosure to final answer', async () => {
  const assistant = new AssistantService({
    profile: { provider: 'fixture', model: 'fixture', instructionMode: 'system' },
    provider: { async answer() { return 'Ответ.'; } },
    webSearchService: { async prepare() { return { status: 'quota_exhausted', sources: [] }; } },
  });
  assert.match(await assistant.answer({ currentRequest: 'current weather' }), /Не удалось проверить актуальность/);
});
