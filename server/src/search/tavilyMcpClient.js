const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { MAX_RESPONSE_BYTES, safeQuery, normalizeSources } = require('./searchSchemas');

const ENDPOINT = 'https://mcp.tavily.com/mcp/';
const empty = (status) => ({ status, sources: [] });

function boundedFetch(fetchImpl, signal) {
  return async (url, options = {}) => {
    const combinedSignal = options.signal ? AbortSignal.any([signal.signal, options.signal]) : signal.signal;
    const response = await fetchImpl(url, { ...options, signal: combinedSignal, redirect: 'error' });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error('MCP_RESPONSE_TOO_LARGE'); }
    if (!response.body) return response;
    const reader = response.body.getReader();
    let size = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); controller.error(new Error('MCP_RESPONSE_TOO_LARGE')); return; }
        controller.enqueue(value);
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

async function closeWithin(operation) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => { timer = setTimeout(resolve, 200); }),
    ]);
  } catch { /* connection disposal is best effort */ }
  finally { clearTimeout(timer); }
}

function quotaFailure(error) {
  const code = String(error?.code || error?.data?.code || '');
  return /^(QUOTA_EXHAUSTED|CREDITS_EXHAUSTED|USAGE_LIMIT_EXCEEDED)$/i.test(code);
}

function parseToolResult(result) {
  if (result?.isError) {
    const item = result.content?.find((part) => part.type === 'text');
    const data = item && JSON.parse(item.text);
    const error = new Error('MCP_TOOL_ERROR');
    error.code = data?.code || data?.error?.code;
    throw error;
  }
  if (result?.structuredContent) return result.structuredContent;
  const item = result?.content?.find((part) => part.type === 'text');
  if (!item || Buffer.byteLength(item.text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('MCP_INVALID_RESULT');
  return JSON.parse(item.text);
}

class TavilyMcpClient {
  constructor({ apiKey, timeoutMs = 15000, clientFactory, transportFactory, fetchImpl } = {}) {
    this.apiKey = apiKey || '';
    this.timeoutMs = timeoutMs;
    this.clientFactory = clientFactory || (() => new Client({ name: 'jarvis-web-search', version: '1.0.0' }, { capabilities: {} }));
    this.transportFactory = transportFactory || ((url, options) => new StreamableHTTPClientTransport(url, options));
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.controllers = new Set();
    this.closed = false;
  }

  async search({ query, signal } = {}) {
    if (this.closed || !this.apiKey) return empty('disabled');
    const safe = safeQuery(query);
    if (!safe) return empty('invalid_query');
    const controller = new AbortController();
    this.controllers.add(controller);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let client;
    let transport;
    try {
      if (controller.signal.aborted) return empty('unavailable');
      client = this.clientFactory();
      transport = this.transportFactory(new URL(ENDPOINT), {
        requestInit: { headers: { Authorization: `Bearer ${this.apiKey}` }, redirect: 'error' },
        fetch: boundedFetch(this.fetchImpl, controller),
      });
      const deadline = async (operation) => Promise.race([
        operation(),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('MCP_ABORTED')), { once: true })),
      ]);
      await deadline(() => client.connect(transport));
      const listed = await deadline(() => client.listTools(undefined, { signal: controller.signal, timeout: this.timeoutMs }));
      const tool = listed?.tools?.find((item) => item.name === 'tavily_search');
      const properties = tool?.inputSchema?.properties || {};
      if (!tool || !properties.query || !properties.search_depth || !properties.max_results || !properties.include_raw_content || !properties.include_images) return empty('unavailable');
      const result = await deadline(() => client.callTool({ name: 'tavily_search', arguments: {
        query: safe, search_depth: 'basic', max_results: 5, include_raw_content: false, include_images: false,
      } }, undefined, { signal: controller.signal, timeout: this.timeoutMs }));
      const sources = normalizeSources(parseToolResult(result));
      return { status: sources.length ? 'ok' : 'empty', sources };
    } catch (error) {
      return empty(quotaFailure(error) ? 'quota_exhausted' : 'unavailable');
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal?.removeEventListener('abort', onAbort);
      this.controllers.delete(controller);
      if (client) await closeWithin(() => client.close());
      if (transport) await closeWithin(() => transport.close());
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }
}

module.exports = { TavilyMcpClient, ENDPOINT };
