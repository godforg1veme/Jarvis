const assert = require('node:assert/strict');
const test = require('node:test');
const { FallbackProvider } = require('../src/providers/fallbackProvider');
const { OpenAiCompatibleProvider, completionUrl } = require('../src/providers/openAiCompatibleProvider');

test('builds an OpenAI-compatible chat completion URL', () => {
  assert.equal(completionUrl('https://ai.salad.cloud/v1/'), 'https://ai.salad.cloud/v1/chat/completions');
});

test('OpenAI-compatible provider sends bearer auth and parses content', async () => {
  let request;
  const provider = new OpenAiCompatibleProvider({
    name: 'salad',
    baseUrl: 'https://ai.salad.cloud/v1',
    apiKey: 'test-secret',
    model: 'test-model',
    reasoning: { effort: 'medium', exclude: true },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: ' Привет! ' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(await provider.answer({ text: 'Привет' }), 'Привет!');
  assert.equal(request.url, 'https://ai.salad.cloud/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'test-model',
    messages: [{ role: 'user', content: 'Привет' }],
    stream: false,
    reasoning: { effort: 'medium', exclude: true },
  });
});

test('fallback provider uses the next provider after a failure', async () => {
  const events = [];
  const provider = new FallbackProvider([
    { name: 'salad', async answer() { throw new Error('offline'); } },
    { name: 'openrouter', async answer() { return 'fallback answer'; } },
  ], { onFallback(name) { events.push(name); } });

  assert.equal(await provider.answer({ text: 'question' }), 'fallback answer');
  assert.deepEqual(events, ['salad']);
});

test('fallback provider does not retry another model when tools are available', async () => {
  let fallbackCalls = 0;
  const provider = new FallbackProvider([
    { name: 'salad', async answer() { throw new Error('offline'); } },
    { name: 'openrouter', async answer() { fallbackCalls += 1; return 'must not run'; } },
  ]);
  await assert.rejects(
    provider.answer({ runtimeContext: { toolsAvailable: ['file.open'] } }),
    /offline/,
  );
  assert.equal(fallbackCalls, 0);
});
