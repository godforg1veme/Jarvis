const { jobError } = require('./jobSchemas');
const { JOB_LETTER_RESPONSE_FORMAT } = require('./jobPrompt');
const { readBoundedJson } = require('./boundedHttp');
const { buildVacancyPrompt, parseVacancyDecision } = require('./jobVacancyPrompt');

const JOB_MODEL = 'z-ai/glm-5.3-flash';
const JOB_MODEL_PRICE_CAP = Object.freeze({ prompt: 0.15, completion: 0.5, request: 0 });
const DECISION_FORMAT = Object.freeze({ type: 'json_schema', json_schema: {
  name: 'job_vacancy_decision', strict: true, schema: { type: 'object',
    properties: { decision: { type: 'string', enum: ['apply','skip'] },
      directionMatched: { type: 'boolean' },
      reasonCode: { type: 'string', enum: ['DIRECTION_FIT','OUT_OF_DIRECTION','INSUFFICIENT_FIT',
        'MANDATORY_REQUIREMENT','USER_CONSTRAINT','UNCERTAIN'] },
      rationale: { type: 'string' } },
    required: ['decision','directionMatched','reasonCode','rationale'], additionalProperties: false },
} });

function providerUsage(value) {
  const cost = Number.isFinite(value?.cost) && value.cost >= 0 ? value.cost : null;
  return { cost, costBasis: cost === null ? 'unknown' : 'provider' };
}

class JobModelAdapter {
  constructor({ config, fetchImpl = globalThis.fetch }) {
    this.key = config.openrouterApiKey || '';
    this.fetch = fetchImpl;
    this.available = Boolean(this.key);
  }
  async generate({ messages, maxTokens = 6000, responseFormat = JOB_LETTER_RESPONSE_FORMAT }) {
    if (!this.key) throw jobError('JOB_MODEL_NOT_CONFIGURED');
    let data;
    try {
      const response = await this.fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: JOB_MODEL, messages, stream: false, max_tokens: maxTokens,
          // GLM requires reasoning. Keep it low and exclude it from the output.
          reasoning: { effort: 'low', exclude: true }, usage: { include: true },
          response_format: responseFormat,
          provider: { sort: 'price', require_parameters: true, allow_fallbacks: false, max_price: JOB_MODEL_PRICE_CAP },
        }),
      });
      if (!response.ok) { await response.body?.cancel(); throw jobError('JOB_MODEL_UNAVAILABLE'); }
      data = await readBoundedJson(response, 256 * 1024);
    } catch { throw jobError('JOB_MODEL_UNAVAILABLE'); }
    const usage = providerUsage(data?.usage);
    const requestId = typeof data?.id === 'string' && /^[\w.-]{1,150}$/.test(data.id) ? data.id : null;
    const choice = data?.choices?.[0];
    const incomplete = choice && ['length','content_filter'].includes(choice.finish_reason)
      && choice.message?.content == null;
    if (data?.error || (data?.model && data.model !== JOB_MODEL)
      || !choice || (typeof choice.message?.content !== 'string' && !incomplete)) {
      throw Object.assign(jobError('JOB_MODEL_INVALID_OUTPUT'), { modelUsage: usage, modelRequestId: requestId,
        validationReason: 'schema' });
    }
    return { text: typeof choice.message?.content === 'string' ? choice.message.content : '',
      finishReason: choice.finish_reason, usage, requestId, model: JOB_MODEL };
  }
  async evaluate(input) {
    // The cap includes GLM's required reasoning, even when it is excluded from
    // visible output. A 1024-token allowance can end before the decision JSON.
    const result = await this.generate({ messages: buildVacancyPrompt(input), maxTokens: 6000, responseFormat: DECISION_FORMAT });
    try { return { ...parseVacancyDecision(result.text, result.finishReason), usage: result.usage, requestId: result.requestId }; }
    catch (error) { throw Object.assign(error, { modelUsage: result.usage, modelRequestId: result.requestId }); }
  }
}
module.exports = { JobModelAdapter, JOB_MODEL, JOB_MODEL_PRICE_CAP, providerUsage };
