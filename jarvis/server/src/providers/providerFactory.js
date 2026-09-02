const { EchoProvider } = require('./echoProvider');
const { FallbackProvider } = require('./fallbackProvider');
const { GeminiProvider } = require('./geminiProvider');
const { OpenAiCompatibleProvider } = require('./openAiCompatibleProvider');

function providerByName(name, config, options = {}) {
  if (!name || name === 'echo') return new EchoProvider();
  if (name === 'salad') {
    return new OpenAiCompatibleProvider({
      name: 'salad',
      baseUrl: config.saladBaseUrl,
      apiKey: config.saladApiKey,
      model: config.saladModel,
      authMode: config.saladAuthMode,
      timeoutMs: config.modelTimeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }
  if (name === 'openrouter') {
    return new OpenAiCompatibleProvider({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: config.openrouterApiKey,
      model: config.openrouterModel,
      reasoning: config.openrouterReasoningEffort
        ? { effort: config.openrouterReasoningEffort, exclude: config.openrouterReasoningExclude }
        : null,
      timeoutMs: config.modelTimeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }
  if (name === 'gemini') {
    return new GeminiProvider({
      name: 'gemini',
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      timeoutMs: config.modelTimeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }
  throw new Error(`unsupported model provider: ${name}`);
}

function createOpenRouterFallback(config, options = {}) {
  if (!config.openrouterFallbackApiKey || !config.openrouterFallbackModel) return null;
  return new OpenAiCompatibleProvider({
    name: 'openrouter-fallback',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterFallbackApiKey,
    model: config.openrouterFallbackModel,
    reasoning: config.openrouterReasoningEffort
      ? { effort: config.openrouterReasoningEffort, exclude: config.openrouterReasoningExclude }
      : null,
    timeoutMs: config.modelTimeoutMs,
    fetchImpl: options.fetchImpl,
  });
}

function createAnswerProvider(config, options = {}) {
  const providers = [providerByName(config.modelProvider, config, options)];
  if (config.modelFallbackProvider) providers.push(providerByName(config.modelFallbackProvider, config, options));
  const openRouterFallback = createOpenRouterFallback(config, options);
  if (openRouterFallback) providers.push(openRouterFallback);
  if (config.geminiApiKey && config.geminiModel) providers.push(providerByName('gemini', config, options));
  if (providers.length === 1) return providers[0];
  return new FallbackProvider(providers, {
    onFallback: options.onFallback,
  });
}

module.exports = { createAnswerProvider, createOpenRouterFallback, providerByName };
