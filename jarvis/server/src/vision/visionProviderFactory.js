const { DisabledVisionProvider, FakeVisionProvider } = require('./visionProvider');
const { OpenRouterVisionProvider } = require('./openRouterVisionProvider');

function createVisionProvider(config, options = {}) {
  if (config.visionProvider === 'fake') return new FakeVisionProvider(options.fake || {});
  if (config.visionProvider === 'openrouter') return new OpenRouterVisionProvider({
    apiKey: config.visionApiKey || config.openrouterApiKey,
    model: config.visionModel,
    baseUrl: config.visionBaseUrl,
    timeoutMs: config.visionTimeoutMs,
    fetchImpl: options.fetchImpl,
  });
  return new DisabledVisionProvider();
}

module.exports = { createVisionProvider };
