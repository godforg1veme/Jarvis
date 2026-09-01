const { EchoProvider } = require('./echoProvider');
const { FallbackProvider } = require('./fallbackProvider');
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
  throw new Error(`unsupported model provider: ${name}`);
}

function createAnswerProvider(config, options = {}) {
  const primary = providerByName(config.modelProvider, config, options);
  if (!config.modelFallbackProvider) return primary;
  const fallback = providerByName(config.modelFallbackProvider, config, options);
  return new FallbackProvider([primary, fallback], {
    onFallback: options.onFallback,
  });
}

module.exports = { createAnswerProvider, providerByName };
