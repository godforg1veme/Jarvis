const BASE_URL = 'https://openrouter.ai/api/v1';
const REFRESH_MS = 15 * 60 * 1000;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

function routingError(code) {
  return Object.assign(new Error('OpenRouter routing unavailable'), { code });
}

async function readJson(response) {
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_CATALOG_BYTES)
    throw routingError('catalog_unavailable');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_BYTES) { await reader.cancel(); throw routingError('catalog_unavailable'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function price(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:e-?\d+)?$/i.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) && Number.isFinite(result * 1000000) && result >= 0 ? result : null;
}

function metadata(model) {
  if (!model || typeof model.id !== 'string' || model.id.length > 255) return null;
  const pricing = model.pricing;
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return null;
  const prompt = price(pricing.prompt), completion = price(pricing.completion);
  const request = pricing.request === undefined ? 0 : price(pricing.request);
  if (prompt === null || completion === null || request === null || pricing.overrides !== undefined) return null;
  const context = model.context_length;
  if (!Number.isInteger(context) || context < 1) return null;
  return {
    id: model.id, prompt, completion, request, context,
    free: Object.values(pricing).length > 0 && Object.values(pricing).every((v) => price(v) === 0),
    text: model.architecture?.input_modalities?.includes('text') === true
      && model.architecture?.output_modalities?.includes('text') === true,
    parameters: Array.isArray(model.supported_parameters) ? model.supported_parameters.filter((p) => typeof p === 'string') : [],
    reasoningOptional: model.reasoning?.mandatory === false,
    reasoningMandatory: model.reasoning?.mandatory === true,
  };
}

class OpenRouterCatalog {
  constructor({ apiKey, modelIds, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.apiKey = apiKey; this.modelIds = new Set(modelIds); this.fetch = fetchImpl; this.now = now;
    this.models = []; this.expires = 0; this.retryAt = 0; this.pending = null; this.freeRemaining = null;
  }

  async get(path, timeoutMs = 10000) {
    try {
      return await readJson(await this.fetch(`${BASE_URL}/${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }, redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      }));
    } catch { throw routingError('catalog_unavailable'); }
  }

  async refreshQuota(timeoutMs = 10000) {
    try {
      const data = await this.get('key', timeoutMs);
      const value = data.data?.free_model_daily_requests?.remaining;
      this.freeRemaining = Number.isSafeInteger(value) && value >= 0 ? value : null;
    } catch { /* Unknown quota still requires a zero-price request. */ }
  }

  async snapshot() {
    if (this.now() < this.expires) return this.models;
    if (this.pending) return this.pending;
    if (this.now() < this.retryAt) throw routingError('catalog_unavailable');
    this.pending = (async () => {
      try {
        const [data] = await Promise.all([this.get('models/user'), this.refreshQuota()]);
        if (!Array.isArray(data.data) || data.data.length > 10000) throw routingError('catalog_unavailable');
        this.models = data.data.filter((m) => this.modelIds.has(m?.id)).map(metadata).filter(Boolean);
        if (new Set(this.models.map((m) => m.id)).size !== this.models.length) throw routingError('catalog_unavailable');
        this.expires = this.now() + REFRESH_MS;
        return this.models;
      } catch {
        this.retryAt = this.now() + 30000;
        throw routingError('catalog_unavailable');
      } finally { this.pending = null; }
    })();
    return this.pending;
  }
}

module.exports = { OpenRouterCatalog, BASE_URL, REFRESH_MS, metadata, routingError };
