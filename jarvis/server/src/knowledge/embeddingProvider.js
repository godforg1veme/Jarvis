const MAX_INPUTS = 256;
const MAX_BATCH_INPUTS = 64;
const MAX_TOTAL_INPUT_CHARS = 2 * 1024 * 1024;
const MAX_INPUT_CHARS = 20000;
const MAX_VECTOR_DIMENSIONS = 4096;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function normalizeText(value) {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_INPUT_CHARS) throw new Error('embedding input is invalid');
  return text;
}

function normalizeVector(value, expectedDimensions = 0) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VECTOR_DIMENSIONS) {
    throw new Error('embedding vector is invalid');
  }
  const vector = value.map((item) => Number(item));
  if (!vector.every(Number.isFinite)) throw new Error('embedding vector contains a non-finite value');
  if (expectedDimensions && vector.length !== expectedDimensions) {
    throw new Error('embedding vector dimensions do not match configuration');
  }
  return vector;
}

function vectorLiteral(vector) {
  return `[${normalizeVector(vector).map((value) => {
    if (!Number.isFinite(value)) throw new Error('embedding vector contains a non-finite value');
    return String(value);
  }).join(',')}]`;
}

function embeddingsUrl(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');
  return `${normalized}/embeddings`;
}

class OpenAiCompatibleEmbeddingProvider {
  constructor(options = {}) {
    this.name = options.name || 'openai-compatible-embeddings';
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimensions = Number(options.dimensions || 0);
    this.timeoutMs = Number(options.timeoutMs || 60000);
    this.batchSize = Math.min(Math.max(Number(options.batchSize || 32), 1), MAX_BATCH_INPUTS);
    this.fetch = options.fetchImpl || globalThis.fetch;
  }

  async embedDocuments(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_INPUTS) {
      throw new Error('embedding batch is invalid');
    }

    const texts = input.map(normalizeText);
    if (texts.reduce((total, text) => total + text.length, 0) > MAX_TOTAL_INPUT_CHARS) {
      throw new Error('embedding batch is too large');
    }
    const result = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const embeddings = await this._request(batch);
      result.push(...embeddings);
    }
    return result;
  }

  async embedQuery(input) {
    const embeddings = await this.embedDocuments([input]);
    return embeddings[0];
  }

  async _request(input) {
    if (typeof this.fetch !== 'function') throw new Error('embedding transport is unavailable');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      const response = await this.fetch(embeddingsUrl(this.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.model, input }),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('content-length') || 0
        : 0);
      if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('embedding response is too large');
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('embedding response is too large');
      if (!response.ok) throw new Error(`${this.name} request failed with HTTP ${response.status}`);
      let body;
      try {
        body = JSON.parse(raw);
      } catch (_) {
        throw new Error(`${this.name} returned invalid JSON`);
      }
      if (!Array.isArray(body && body.data) || body.data.length !== input.length) {
        throw new Error(`${this.name} returned an invalid embedding batch`);
      }
      const ordered = [...body.data].sort((left, right) => Number(left.index) - Number(right.index));
      const indexes = ordered.map((item) => Number(item && item.index));
      if (indexes.some((index, position) => index !== position)) {
        throw new Error(`${this.name} returned invalid embedding indexes`);
      }
      return ordered.map((item) => normalizeVector(item && item.embedding, this.dimensions));
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error(`${this.name} request timed out`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function createEmbeddingProvider(config, options = {}) {
  if (!config || !config.embeddingProvider || config.embeddingProvider === 'disabled') return null;
  if (config.embeddingProvider === 'openai-compatible') {
    return new OpenAiCompatibleEmbeddingProvider({
      name: 'configured-embeddings',
      baseUrl: config.embeddingBaseUrl,
      apiKey: config.embeddingApiKey,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
      timeoutMs: config.embeddingTimeoutMs,
      batchSize: config.embeddingBatchSize,
      fetchImpl: options.fetchImpl,
    });
  }
  throw new Error(`unsupported embedding provider: ${config.embeddingProvider}`);
}

module.exports = {
  MAX_INPUTS,
  MAX_INPUT_CHARS,
  MAX_VECTOR_DIMENSIONS,
  OpenAiCompatibleEmbeddingProvider,
  createEmbeddingProvider,
  embeddingsUrl,
  normalizeVector,
  vectorLiteral,
};
