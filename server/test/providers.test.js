const assert = require('node:assert/strict');
const test = require('node:test');
const { FallbackProvider } = require('../src/providers/fallbackProvider');
const { GeminiProvider, toGeminiRequest } = require('../src/providers/geminiProvider');
const { OpenAiCompatibleProvider, completionUrl } = require('../src/providers/openAiCompatibleProvider');
const { createAnswerProvider } = require('../src/providers/providerFactory');

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

test('Gemini provider translates canonical chat messages without exposing the key in the URL', async () => {
  let request;
  const provider = new GeminiProvider({
    apiKey: 'gemini-secret',
    model: 'gemini-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: ' Привет от Gemini ' }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(await provider.answer({ messages: [
    { role: 'system', content: 'Policy' },
    { role: 'user', content: 'Привет' },
    { role: 'assistant', content: 'Здравствуйте' },
  ] }), 'Привет от Gemini');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'], 'gemini-secret');
  assert.deepEqual(JSON.parse(request.options.body), {
    systemInstruction: { parts: [{ text: 'Policy' }] },
    contents: [
      { role: 'user', parts: [{ text: 'Привет' }] },
      { role: 'model', parts: [{ text: 'Здравствуйте' }] },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  });
});

test('Gemini message adapter keeps an empty request valid', () => {
  assert.deepEqual(toGeminiRequest([]), {
    contents: [{ role: 'user', parts: [{ text: '' }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  });
});

test('provider factory falls through secondary OpenRouter then Gemini', async () => {
  const calls = [];
  const provider = createAnswerProvider({
    modelProvider: 'salad',
    saladBaseUrl: 'https://salad.example/v1',
    saladApiKey: 'salad-key',
    saladModel: 'salad-model',
    saladAuthMode: 'bearer',
    openrouterFallbackApiKey: 'secondary-key',
    openrouterFallbackModel: 'secondary-model',
    geminiApiKey: 'gemini-key',
    geminiModel: 'gemini-model',
    modelTimeoutMs: 1000,
    openrouterReasoningEffort: '',
    openrouterReasoningExclude: false,
  }, {
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('salad.example')) throw new Error('salad offline');
      if (url.includes('openrouter.ai')) throw new Error('secondary offline');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini fallback' }] } }] }), { status: 200 });
    },
  });

  assert.equal(await provider.answer({ text: 'question', runtimeContext: { toolsAvailable: [] } }), 'Gemini fallback');
  assert.equal(calls.length, 3);
  assert.match(calls[1], /openrouter\.ai/);
  assert.match(calls[2], /generativelanguage\.googleapis\.com/);
});
