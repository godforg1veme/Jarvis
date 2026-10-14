const { OpenAiCompatibleProvider } = require('../providers/openAiCompatibleProvider');
const { jobError } = require('./jobSchemas');

class JobModelAdapter {
  constructor({ config, fetchImpl }) { this.config = config; this.fetch = fetchImpl; }
  async generate({ messages, model }) {
    if (!this.config.openrouterApiKey || !model) throw jobError('JOB_MODEL_NOT_CONFIGURED');
    const provider = new OpenAiCompatibleProvider({ name: 'openrouter-jobs',
      baseUrl: 'https://openrouter.ai/api/v1', apiKey: this.config.openrouterApiKey, model,
      timeoutMs: this.config.modelTimeoutMs || 60000,
      reasoning: { effort: 'low', exclude: true }, fetchImpl: this.fetch });
    try { return await provider.answerWithUsage({ messages, maxTokens: 3000, includeUsage: true }); }
    catch { throw jobError('JOB_MODEL_UNAVAILABLE'); }
  }
}
module.exports = { JobModelAdapter };
