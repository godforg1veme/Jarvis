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
    this.fetch = options.fetchImpl || globalThis.fetch;
  }

  async answer({ text, messages }) {
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
      const response = await this.fetch(completionUrl(this.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${this.name} request failed with HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error(`${this.name} response is too large`);
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) throw new Error(`${this.name} response is too large`);
      const data = JSON.parse(raw);
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error(`${this.name} returned an invalid response`);
      return content.trim();
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
