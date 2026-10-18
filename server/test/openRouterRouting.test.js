const test = require('node:test');
const assert = require('node:assert/strict');
const { FreeFirstProvider, FREE_MODELS } = require('../src/providers/freeFirstProvider');
const { OpenRouterCatalog, REFRESH_MS, metadata } = require('../src/providers/openRouterCatalog');
const { createAnswerProvider } = require('../src/providers/providerFactory');
const { providerProfileForConfig } = require('../src/providers/providerProfile');
const { loadConfig } = require('../src/config/loadConfig');

function model(id, prompt = '0', completion = '0', extra = {}) {
  return { id, context_length: 1000000, pricing: { prompt, completion },
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    supported_parameters: ['tools', 'reasoning'], ...extra };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function fixture(options = {}) {
  let now = 1000;
  const state = { models: [...FREE_MODELS.map((id) => model(id)), model('paid/a', '0.0000001', '0.0000004'), model('paid/b', '0.0000002', '0.0000001')],
    quota: 1000, calls: [], reads: [], failCatalog: false, catalogBody: null, failKey: false, response: options.response };
  const fetchImpl = async (url, request) => {
    if (url.endsWith('/models/user')) {
      state.reads.push('models');
      assert.equal(request.redirect, 'error');
      if (state.failCatalog) throw Error('secret must not escape');
      return state.catalogBody ? state.catalogBody() : json({ data: state.models });
    }
    if (url.endsWith('/key')) { state.reads.push('key'); if (state.failKey) throw Error('secret'); return json({ data: { free_model_daily_requests: { remaining: state.quota } } }); }
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(request.body); state.calls.push(body);
    return state.response ? state.response(body, state.calls.length) : json({ choices: [{ message: { content: 'OK' } }], usage: { cost: 0 } });
  };
  const config = { modelProvider: 'openrouter', openrouterFreeFirst: true, openrouterApiKey: 'fixture-key',
    openrouterModel: 'paid/a', openrouterFallbackModel: 'paid/b', modelTimeoutMs: 60000, openrouterReasoningEffort: 'low' };
  return { state, config, fetchImpl, advance(ms) { now += ms; }, now: () => now,
    provider: new FreeFirstProvider(config, { fetchImpl, now: () => now }) };
}

test('free-first sends exact seven-model priority and zero cost caps before paid candidates', async () => {
  const f = fixture({ response: (body) => FREE_MODELS.includes(body.model) ? json({}, 503) : json({ choices: [{ message: { content: 'paid' } }] }) });
  const result = await f.provider.answerWithUsage({ text: 'hi' });
  assert.deepEqual(f.state.calls.slice(0, 7).map((r) => r.model), [...FREE_MODELS]);
  assert.equal(result.model, 'paid/b');
  assert.equal(f.state.calls.length, 8);
  for (const body of f.state.calls.slice(0, 7)) {
    assert.equal(body.provider.max_price.prompt, 0); assert.equal(body.provider.max_price.completion, 0);
    assert.equal(body.provider.max_price.request, 0); assert.equal(body.provider.allow_fallbacks, false);
  }
  assert.equal(f.state.calls[7].provider.max_price.prompt, 0.2, 'price caps are per million, catalog prices per token');
  assert.equal(f.state.calls[7].provider.max_price.completion, 0.1);
});

test('paid ordering accounts for request size and output budget', async () => {
  const f = fixture(); f.state.quota = 0;
  const short = await f.provider.answerWithUsage({ text: 'hi', maxTokens: 4000 });
  assert.equal(short.model, 'paid/b');
  const long = await f.provider.answerWithUsage({ text: 'x'.repeat(10000), maxTokens: 1 });
  assert.equal(long.model, 'paid/a');
});

test('catalog refresh skips removed or repriced free models and never discovers unapproved IDs', async () => {
  const f = fixture(); await f.provider.answer({ text: 'hi' });
  f.state.models = [model('unapproved/free:free'), model(FREE_MODELS[0], '0.1', '0.2'), model(FREE_MODELS[2])];
  f.advance(REFRESH_MS + 1); f.state.calls = [];
  await f.provider.answer({ text: 'hi' });
  assert.deepEqual(f.state.calls.map((r) => r.model), [FREE_MODELS[2]]);
});

test('approved paid model becoming free moves behind the seven free choices', async () => {
  const f = fixture(); f.state.models = [model('paid/a')];
  assert.equal((await f.provider.answerWithUsage({ text: 'hi' })).model, 'paid/a');
  assert.equal(f.state.calls[0].provider.max_price.prompt, 0);
});

test('free shared quota exhausted after 429 skips all remaining free candidates', async () => {
  const f = fixture(); f.state.response = (body) => {
    if (body.model === FREE_MODELS[0]) { f.state.quota = 0; return json({}, 429); }
    return json({ choices: [{ message: { content: 'OK' } }] });
  };
  await f.provider.answer({ text: 'hi' });
  assert.deepEqual(f.state.calls.map((r) => r.model), [FREE_MODELS[0], 'paid/b']);
});

test('429 cooldown respects Retry-After and does not discard other free models', async () => {
  const f = fixture({ response: (body) => body.model === FREE_MODELS[0] ? json({}, 429, { 'retry-after': '120' }) : json({ choices: [{ message: { content: 'OK' } }] }) });
  await f.provider.answer({ text: 'hi' }); f.state.calls = [];
  f.advance(61000); await f.provider.answer({ text: 'hi' });
  assert.equal(f.state.calls[0].model, FREE_MODELS[1]);
  f.advance(60000); f.state.calls = []; await f.provider.answer({ text: 'hi' });
  assert.equal(f.state.calls[0].model, FREE_MODELS[0]);
});

test('tools prevent retries after dispatch; unknown network outcomes never retry plain chat', async () => {
  for (const kind of ['tools', 'network', 'authentication', 'bad_json', 'unexpected_cost']) {
    const f = fixture({ response: () => {
      if (kind === 'network') throw Error('credential-bearing network exception');
      if (kind === 'authentication') return json({}, 401);
      if (kind === 'bad_json') return new Response('invalid');
      if (kind === 'unexpected_cost') return json({ choices: [{ message: { content: 'OK' } }], usage: { cost: 1 } });
      return json({}, 503);
    } });
    await assert.rejects(f.provider.answer({ text: 'hi', ...(kind === 'tools' ? { runtimeContext: { toolsAvailable: ['file.open'] } } : {}) }), (e) => e.message === 'OpenRouter routing unavailable');
    assert.equal(f.state.calls.length, 1, kind);
  }
});

test('context/tool capability filtering happens before dispatch and quota tracks successful requests locally', async () => {
  const f = fixture(); f.state.quota = 1;
  f.state.models[0].supported_parameters = [];
  f.state.models[1].context_length = 2;
  assert.equal((await f.provider.answerWithUsage({ text: 'hi', runtimeContext: { toolsAvailable: ['file.open'] } })).model, FREE_MODELS[2]);
  assert.equal((await f.provider.answerWithUsage({ text: 'hi' })).model, 'paid/b');
});

test('single-flight catalog refresh uses cache, rejects stale/unavailable and oversized data without completions', async () => {
  const f = fixture(); await Promise.all([f.provider.catalog.snapshot(), f.provider.catalog.snapshot()]);
  assert.deepEqual(f.state.reads.sort(), ['key', 'models']);
  await f.provider.catalog.snapshot(); assert.equal(f.state.reads.length, 2);
  f.advance(REFRESH_MS + 1); f.state.failCatalog = true;
  await assert.rejects(f.provider.answer({ text: 'hi' }), /routing unavailable/);
  const count = f.state.reads.length;
  await assert.rejects(f.provider.answer({ text: 'hi' })); assert.equal(f.state.reads.length, count);
  assert.equal(f.state.calls.length, 0);
  const g = fixture(); g.state.catalogBody = () => new Response('x', { headers: { 'content-length': String(9 * 1024 * 1024) } });
  await assert.rejects(g.provider.answer({ text: 'hi' })); assert.equal(g.state.calls.length, 0);
});

test('unknown or malformed prices cannot classify a model as free or paid', () => {
  for (const pricing of [{ prompt: null, completion: '0' }, { prompt: '', completion: '0' }, { prompt: '-1', completion: '0' }, { prompt: 'NaN', completion: '0' }, { prompt: '0', completion: '0', request: '-1' }, { prompt: '0', completion: '0', overrides: [] }]) {
    assert.equal(metadata(model('x', '0', '0', { pricing })), null);
  }
  assert.equal(metadata(model('x', '0', '0', { pricing: { prompt: '0', completion: '0', image: '0.1' } })).free, false);
});

test('paid price changes refresh after TTL and alter ranking without adding models', async () => {
  const f = fixture(); f.state.quota = 0;
  assert.equal((await f.provider.answerWithUsage({ text: 'hi' })).model, 'paid/b');
  f.state.models = [model('paid/a', '0.00000001', '0.00000001'), model('paid/b', '0.000001', '0.000001')];
  f.advance(REFRESH_MS + 1);
  assert.equal((await f.provider.answerWithUsage({ text: 'hi' })).model, 'paid/a');
});

test('malformed catalog body, duplicate IDs and streamed oversized body fail closed', async () => {
  for (const kind of ['json', 'duplicate', 'stream']) {
    const f = fixture();
    if (kind === 'duplicate') f.state.models.push(f.state.models[0]);
    else f.state.catalogBody = () => new Response(kind === 'json' ? '{' : new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); controller.close();
    } }));
    await assert.rejects(f.provider.answer({ text: 'hi' }));
    assert.equal(f.state.calls.length, 0);
  }
});

test('routing deadline stops the queue, invalid output cap never dispatches, unknown quota still enforces zero price', async () => {
  const f = fixture(); f.state.response = () => { f.advance(60001); return json({}, 503); };
  await assert.rejects(f.provider.answer({ text: 'hi' }), (e) => e.code === 'routing_deadline');
  assert.equal(f.state.calls.length, 1);
  const g = fixture(); await assert.rejects(g.provider.answer({ text: 'hi', maxTokens: 20000 }));
  assert.equal(g.state.calls.length, 0);
  g.state.failKey = true; g.advance(REFRESH_MS + 1);
  await g.provider.answer({ text: 'hi' });
  assert.equal(g.state.calls[0].provider.max_price.prompt, 0);
});

test('free-first configuration is opt-in, requires OpenRouter and selects its provider/profile', () => {
  assert.equal(loadConfig({}).openrouterFreeFirst, false);
  assert.throws(() => loadConfig({ JARVIS_OPENROUTER_FREE_FIRST: 'true' }), /OpenRouter primary/);
  const f = fixture();
  const config = loadConfig({ JARVIS_OPENROUTER_FREE_FIRST: 'true', JARVIS_MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'paid/a' });
  assert.ok(createAnswerProvider(config, { fetchImpl: f.fetchImpl }) instanceof FreeFirstProvider);
  assert.equal(providerProfileForConfig(config).model, 'free-first');
  assert.equal(providerProfileForConfig(config).instructionMode, 'reinforced-current-user');
});
