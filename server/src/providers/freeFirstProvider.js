const { OpenAiCompatibleProvider } = require('./openAiCompatibleProvider');
const { OpenRouterCatalog, BASE_URL, routingError } = require('./openRouterCatalog');

const FREE_MODELS = Object.freeze([
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'dots-studio/dots-3-note-preview:free',
  'poolside/laguna-s-2.1:free',
]);
const RETRYABLE = new Set([404, 429, 502, 503, 504]);

class FreeFirstProvider {
  constructor(config, options = {}) {
    this.name = 'openrouter-free-first';
    this.now = options.now || Date.now; this.fetch = options.fetchImpl || globalThis.fetch;
    this.apiKey = config.openrouterApiKey; this.timeoutMs = config.modelTimeoutMs || 60000;
    this.reasoning = config.openrouterReasoningEffort
      ? { effort: config.openrouterReasoningEffort, exclude: config.openrouterReasoningExclude } : null;
    this.paidIds = [...new Set([config.openrouterModel, config.openrouterFallbackModel].filter(Boolean))];
    this.catalog = new OpenRouterCatalog({ apiKey: this.apiKey, modelIds: [...FREE_MODELS, ...this.paidIds], fetchImpl: this.fetch, now: this.now });
    this.cooldowns = new Map();
  }

  async answer(input) { return (await this.answerWithUsage(input)).text; }

  async answerWithUsage(input = {}) {
    const started = this.now();
    const models = await this.catalog.snapshot();
    const maxTokens = input.maxTokens === undefined ? 4096 : input.maxTokens;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 16384) throw routingError('invalid_token_limit');
    // UTF-8 byte count is a conservative token bound; no prompt text is cached.
    const inputSize = Buffer.byteLength(JSON.stringify(input.messages || [{ role: 'user', content: String(input.text || '') }]), 'utf8');
    const hasTools = Array.isArray(input.runtimeContext?.toolsAvailable) && input.runtimeContext.toolsAvailable.length > 0;
    const usable = (m) => m.text && m.context >= inputSize + maxTokens
      && (!hasTools || m.parameters.includes('tools')) && (this.cooldowns.get(m.id) || 0) <= this.now();
    const free = [...new Set([...FREE_MODELS, ...this.paidIds])]
      .map((id) => models.find((m) => m.id === id && m.free)).filter((m) => m && usable(m));
    const paid = this.paidIds.map((id) => models.find((m) => m.id === id && !m.free)).filter((m) => m && usable(m))
      .sort((a, b) => (a.prompt * inputSize + a.completion * maxTokens + a.request)
        - (b.prompt * inputSize + b.completion * maxTokens + b.request));
    for (const model of [...free, ...paid]) {
      if (model.free && this.catalog.freeRemaining === 0) continue;
      const remaining = this.timeoutMs - (this.now() - started);
      if (remaining < 1000) throw routingError('routing_deadline');
      const provider = new OpenAiCompatibleProvider({
        name: this.name, baseUrl: BASE_URL, apiKey: this.apiKey, model: model.id,
        fetchImpl: this.fetch, timeoutMs: remaining,
        reasoning: model.parameters.includes('reasoning') ? this.reasoning : null,
        providerRouting: {
          sort: 'price', allow_fallbacks: false,
          // OpenRouter prompt/completion caps use dollars per MILLION tokens.
          max_price: { prompt: Number((model.prompt * 1000000).toPrecision(15)),
            completion: Number((model.completion * 1000000).toPrecision(15)), request: model.request, image: 0, audio: 0 },
        },
      });
      try {
        const result = await provider.answerWithUsage({ ...input, maxTokens, includeUsage: true });
        if (model.free) {
          if ((result.usage.cost || 0) > 0) throw routingError('unexpected_free_cost');
          if (this.catalog.freeRemaining !== null) this.catalog.freeRemaining = Math.max(0, this.catalog.freeRemaining - 1);
        }
        return { ...result, model: model.id };
      } catch (error) {
        if (error.status === 429 || error.status === 404) {
          this.cooldowns.set(model.id, this.now() + Math.max(60000, error.retryAfterMs || 0));
        }
        if (hasTools || !RETRYABLE.has(error.status)) throw routingError('model_request_failed');
        const quotaDeadline = this.timeoutMs - (this.now() - started);
        if (model.free && error.status === 429 && quotaDeadline >= 1000)
          await this.catalog.refreshQuota(Math.min(10000, quotaDeadline));
      }
    }
    throw routingError('no_eligible_model');
  }
}

module.exports = { FreeFirstProvider, FREE_MODELS };
