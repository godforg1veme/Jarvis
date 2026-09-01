class FallbackProvider {
  constructor(providers, options = {}) {
    this.providers = providers.filter(Boolean);
    this.onFallback = options.onFallback || (() => {});
  }

  async answer(input) {
    let lastError;
    for (let index = 0; index < this.providers.length; index += 1) {
      const provider = this.providers[index];
      try {
        return await provider.answer(input);
      } catch (error) {
        lastError = error;
        if (index < this.providers.length - 1) this.onFallback(provider.name || 'unknown', error);
      }
    }
    throw lastError || new Error('no model provider configured');
  }
}

module.exports = { FallbackProvider };
