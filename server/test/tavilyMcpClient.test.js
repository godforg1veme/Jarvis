const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TavilyMcpClient, ENDPOINT } = require('../src/search/tavilyMcpClient');

function fixture(overrides = {}) {
  const calls = [];
  const client = {
    async connect() {},
    async listTools() { return { tools: [{ name: 'tavily_search', inputSchema: { properties: {
      query: {}, search_depth: {}, max_results: {}, include_raw_content: {}, include_images: {},
    } } }] }; },
    async callTool(input) { calls.push(input); return { content: [{ type: 'text', text: JSON.stringify({ results: [
      { title: 'Docs', url: 'https://example.org/docs', content: 'Text' },
    ] }) }] }; },
    async close() {},
    ...overrides,
  };
  let options;
  const service = new TavilyMcpClient({ apiKey: 'fixture-only', clientFactory: () => client,
    transportFactory: (url, opts) => { assert.equal(url.href, ENDPOINT); options = opts; return { async close() {} }; },
  });
  return { service, calls, get options() { return options; } };
}

test('fixed MCP endpoint, bearer auth and basic search only', async () => {
  const setup = fixture();
  const result = await setup.service.search({ query: 'public product documentation' });
  assert.equal(result.status, 'ok');
  assert.equal(result.sources[0].id, 'W1');
  assert.equal(setup.options.requestInit.headers.Authorization, 'Bearer fixture-only');
  assert.equal(setup.options.requestInit.redirect, 'error');
  assert.deepEqual(setup.calls[0].arguments, { query: 'public product documentation', search_depth: 'basic', max_results: 5,
    include_raw_content: false, include_images: false });
  await setup.service.close(); await setup.service.close();
});

test('invalid query does not open MCP connection', async () => {
  const setup = fixture();
  for (const query of ['person@example.org', 'Bearer fixtureSecretAlphaBetaGamma', 'ghp_fixtureSecretAlphaBetaGamma',
    'intranet.company.local/path', '10.1.2.3/internal']) {
    assert.equal((await setup.service.search({ query })).status, 'invalid_query');
  }
  assert.equal(setup.options, undefined);
});

test('malformed and tool error results stay unavailable', async () => {
  for (const result of [{ content: [{ type: 'text', text: 'broken' }] }, { isError: true, content: [{ type: 'text', text: 'failed' }] }]) {
    const setup = fixture({ async callTool() { return result; } });
    assert.equal((await setup.service.search({ query: 'public docs' })).status, 'unavailable');
  }
});

test('recognized quota error is distinct from an ordinary tool error', async () => {
  const setup = fixture({ async callTool() { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'QUOTA_EXHAUSTED' }) }] }; } });
  assert.deepEqual(await setup.service.search({ query: 'public docs' }), { status: 'quota_exhausted', sources: [] });
});

test('empty results and unsafe URLs are excluded', async () => {
  const setup = fixture({ async callTool() { return { structuredContent: { results: [
    { title: 'Private', url: 'http://127.0.0.1/x', content: 'a' },
  ] } }; } });
  assert.deepEqual(await setup.service.search({ query: 'public docs' }), { status: 'empty', sources: [] });
});

test('deadline aborts stalled tool operation', async () => {
  const setup = fixture({ async callTool(_input, _schema, options) {
    return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ content: [] }), { once: true }));
  } });
  setup.service.timeoutMs = 20;
  assert.equal((await setup.service.search({ query: 'public docs' })).status, 'unavailable');
});

test('disabled client has no network activity', async () => {
  const client = new TavilyMcpClient({ apiKey: '', clientFactory: () => { throw new Error('opened'); } });
  assert.deepEqual(await client.search({ query: 'public docs' }), { status: 'disabled', sources: [] });
});

test('response body is capped before MCP parsing', async () => {
  const oversized = new Uint8Array(256 * 1024 + 1);
  const client = new TavilyMcpClient({ apiKey: 'fixture-only', fetchImpl: async () => new Response(oversized),
    clientFactory: () => ({ async connect() {}, async listTools() { return { tools: [] }; }, async close() {} }),
    transportFactory: (_url, options) => ({ options, async close() {} }),
  });
  let fetchWrapper;
  client.transportFactory = (_url, options) => { fetchWrapper = options.fetch; return { async close() {} }; };
  await client.search({ query: 'public docs' });
  await assert.rejects(async () => { const bounded = await fetchWrapper(ENDPOINT); await bounded.text(); }, /MCP_RESPONSE_TOO_LARGE/);
});

test('chunked response is capped while streaming', async () => {
  let fetchWrapper;
  const client = new TavilyMcpClient({ apiKey: 'fixture-only',
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(200 * 1024));
      controller.enqueue(new Uint8Array(100 * 1024));
      controller.close();
    } })),
    clientFactory: () => ({ async connect() {}, async listTools() { return { tools: [] }; }, async close() {} }),
    transportFactory: (_url, options) => { fetchWrapper = options.fetch; return { async close() {} }; },
  });
  await client.search({ query: 'public docs' });
  await assert.rejects(async () => (await fetchWrapper(ENDPOINT)).text(), /MCP_RESPONSE_TOO_LARGE/);
});

test('real SDK transport closes its background SSE fetch after search', async () => {
  const fetchSignals = [];
  const methods = [];
  const fakeFetch = async (_url, options) => {
    assert.equal(options.redirect, 'error');
    if (options.method === 'GET') {
      fetchSignals.push(options.signal);
      return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } });
    }
    const request = JSON.parse(options.body);
    methods.push(request.method);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : request.method === 'tools/list'
        ? { tools: [{ name: 'tavily_search', inputSchema: { type: 'object', properties: {
          query: {}, search_depth: {}, max_results: {}, include_raw_content: {}, include_images: {},
        } } }] }
        : { content: [{ type: 'text', text: JSON.stringify({ results: [
          { title: 'Public', url: 'https://example.org/a', content: 'Fact' },
        ] }) }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  const client = new TavilyMcpClient({ apiKey: 'fixture-only', fetchImpl: fakeFetch });
  const result = await client.search({ query: 'public docs' });
  assert.equal(result.status, 'ok');
  assert.deepEqual(methods.filter((method) => method === 'tools/call'), ['tools/call']);
  assert.equal(fetchSignals.length, 1);
  assert.equal(fetchSignals[0].aborted, true);
});

test('pre-aborted external signal makes no MCP request', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new TavilyMcpClient({ apiKey: 'fixture-only', clientFactory: () => { throw new Error('opened'); } });
  assert.equal((await client.search({ query: 'public docs', signal: controller.signal })).status, 'unavailable');
});
