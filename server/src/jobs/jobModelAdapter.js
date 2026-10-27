const { FreeFirstProvider } = require('../providers/freeFirstProvider');
const { jobError } = require('./jobSchemas');
const { JOB_LETTER_RESPONSE_FORMAT } = require('./jobPrompt');

class JobModelAdapter {
  constructor({ config, fetchImpl }) {
    this.config = config;
    // Letter generation has a bounded output budget; global chat reasoning must not consume it.
    this.provider = config.openrouterApiKey ? new FreeFirstProvider({ ...config,
      openrouterReasoningEffort: 'low', openrouterReasoningExclude: true, modelTimeoutMs: 120000 }, { fetchImpl }) : null;
  }
  async generate({ messages }) {
    if (!this.provider) throw jobError('JOB_MODEL_NOT_CONFIGURED');
    try { return await this.provider.answerWithUsage({ messages, maxTokens: 6000, includeUsage: true,
      responseFormat: JOB_LETTER_RESPONSE_FORMAT }); }
    catch { throw jobError('JOB_MODEL_UNAVAILABLE'); }
  }
}
module.exports = { JobModelAdapter };
