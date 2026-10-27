const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

function completionUrl(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');
  return `${normalized}/chat/completions`;
}

class OpenAiCompatibleProvider {
  constructor(options) {
    this.name = options.name;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs || 60000;
    this.authMode = options.authMode || 'bearer';
    this.reasoning = options.reasoning || null;
    this.providerRouting = options.providerRouting || null;
    this.fetch = options.fetchImpl || globalThis.fetch;
  }

  async answer(input) {
    return (await this.answerWithUsage(input)).text;
  }

  async answerWithUsage({ text, messages, maxTokens, includeUsage = false, responseFormat }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { 'Content-Type': 'application/json' };
    if (this.authMode === 'salad-api-key') headers['Salad-Api-Key'] = this.apiKey;
    else headers.Authorization = `Bearer ${this.apiKey}`;

    try {
      const body = {
        model: this.model,
        messages: messages || [{ role: 'user', content: String(text || '') }],
        stream: false,
      };
      if (this.reasoning) body.reasoning = this.reasoning;
      if (this.providerRouting) body.provider = this.providerRouting;
      if (responseFormat !== undefined) body.response_format = responseFormat;
      if (maxTokens !== undefined) {
        if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 16384) throw new Error('invalid provider token limit');
        body.max_tokens = maxTokens;
      }
      if (includeUsage) body.usage = { include: true };
      const response = await this.fetch(completionUrl(this.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        const seconds = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        throw Object.assign(new Error(`${this.name} request failed with HTTP ${response.status}`), {
          status: response.status,
          retryAfterMs: Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 3600000) : 0,
        });
      }
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error(`${this.name} response is too large`);
      const chunks = []; let byteCount = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          byteCount += part.value.byteLength;
          if (byteCount > MAX_PROVIDER_RESPONSE_BYTES) { await reader.cancel(); throw new Error(`${this.name} response is too large`); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      const raw = Buffer.concat(chunks, byteCount).toString('utf8');
      const data = JSON.parse(raw);
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const reason = data?.choices?.[0]?.finish_reason;
      const finishReason = ['stop', 'length', 'content_filter', 'tool_calls'].includes(reason) ? reason : null;
      const incompleteStructured = responseFormat?.type === 'json_schema'
        && ['length', 'content_filter'].includes(finishReason) && (content == null || typeof content === 'string');
      if ((typeof content !== 'string' || !content.trim()) && !incompleteStructured)
        throw new Error(`${this.name} returned an invalid response`);
      const usage = {};
      for (const key of ['cost', 'prompt_tokens', 'completion_tokens', 'total_tokens']) {
        if (typeof data.usage?.[key] === 'number' && Number.isFinite(data.usage[key]) && data.usage[key] >= 0) usage[key] = data.usage[key];
      }
      return { text: typeof content === 'string' ? content.trim() : '', usage, finishReason,
        requestId: typeof data.id === 'string' && data.id.length <= 150 ? data.id : null };
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error(`${this.name} request timed out`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  MAX_PROVIDER_RESPONSE_BYTES,
  OpenAiCompatibleProvider,
  completionUrl,
};
