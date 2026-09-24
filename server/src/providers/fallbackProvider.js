class FallbackProvider {
  constructor(providers, options = {}) {
    this.providers = providers.filter(Boolean);
    this.onFallback = options.onFallback || (() => {});
  }

  async answer(input) {
    let lastError;
    const safeToFallback = !input || !input.runtimeContext || !Array.isArray(input.runtimeContext.toolsAvailable) || input.runtimeContext.toolsAvailable.length === 0;
    for (let index = 0; index < this.providers.length; index += 1) {
      const provider = this.providers[index];
      try {
        return await provider.answer(input);
      } catch (error) {
        lastError = error;
        if (index < this.providers.length - 1 && safeToFallback) this.onFallback(provider.name || 'unknown', error);
        if (!safeToFallback) break;
      }
    }
    throw lastError || new Error('no model provider configured');
  }
}

module.exports = { FallbackProvider };
