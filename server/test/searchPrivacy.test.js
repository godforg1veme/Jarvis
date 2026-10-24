const test = require('node:test');
const assert = require('node:assert/strict');
const { SearchIntentPlanner } = require('../src/search/searchIntentPlanner');
const { WebSearchService } = require('../src/search/webSearchService');
const { groundedQuery, publicSearchRequest, normalizeSources } = require('../src/search/searchSchemas');

test('planner cannot add unrelated personal names or circumstances to a public query', async () => {
  let externalCalls = 0;
  const planner = new SearchIntentPlanner({ provider: { async answer() {
    return JSON.stringify({ mode: 'search', query: 'Иван Иванов ищет работу после увольнения в Москве' });
  } } });
  const service = new WebSearchService({ planner, client: { async search() { externalCalls++; return {}; } } });
  assert.equal((await service.prepare({ currentRequest: 'Проверь текущие цены на мебель в Москве' })).status, 'unavailable');
  assert.equal(externalCalls, 0);
  assert.equal(groundedQuery('Fastify 5 official documentation', 'Проверь документацию Fastify 5'), 'Fastify 5 official documentation');
});

test('known private material does not reach the search planner', async () => {
  let modelCalls = 0;
  const planner = new SearchIntentPlanner({ provider: { async answer() { modelCalls++; return '{"mode":"skip"}'; } } });
  for (const currentRequest of ['Меня зовут Иван Иванов, найди вакансии', 'Вот моё резюме: опыт управления',
    'Это моя переписка, проверь факты', 'Найди сведения для person@example.org',
    'Проверь новости для телефона +7 999 123-45-67', 'Проверь новости, мой пароль: fixture-only']) {
    assert.equal(publicSearchRequest(currentRequest), false);
    assert.equal((await planner.plan({ currentRequest })).mode, 'unavailable');
  }
  assert.equal(modelCalls, 0);
});

test('credential-bearing source URLs are excluded before prompt context', () => {
  const rows = ['token', 'access_token', 'api_key', 'sig', 'X-Amz-Signature', 'session', 'session_id', 'sid'].map((name) => ({
    title: 'Source', url: `https://example.org/docs?${name}=fixture-only`, content: 'Public text',
  }));
  rows.push({ title: 'Public', url: 'https://example.org/docs?page=2#reference', content: 'Text' });
  assert.deepEqual(normalizeSources({ results: [...rows.slice(0, 4), rows.at(-1)] }), [{
    id: 'W1', title: 'Public', url: 'https://example.org/docs?page=2#reference', excerpt: 'Text',
  }]);
  for (const row of rows.slice(0, -1)) assert.deepEqual(normalizeSources({ results: [row] }), []);
});

test('calendar dates remain valid public search terms', () => {
  assert.equal(groundedQuery('новости 24.10.2026', 'Поищи новости 24.10.2026'), 'новости 24.10.2026');
});
