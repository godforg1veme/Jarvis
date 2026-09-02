const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

function generationUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function asTextPart(content) {
  return { text: String(content || '').slice(0, 200000) };
}

function toGeminiRequest(messages = []) {
  const systemParts = [];
  const contents = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const role = String(message.role || 'user');
    const part = asTextPart(message.content);
    if (role === 'system') {
      systemParts.push(part);
      continue;
    }
    contents.push({ role: role === 'assistant' ? 'model' : 'user', parts: [part] });
  }

  return {
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
    contents: contents.length ? contents : [{ role: 'user', parts: [asTextPart('')] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  };
}

function extractText(data) {
  const parts = data && data.candidates && data.candidates[0]
    && data.candidates[0].content && data.candidates[0].content.parts;
  if (!Array.isArray(parts)) throw new Error('gemini returned an invalid response');
  const text = parts.map((part) => String(part && part.text || '')).join('').trim();
  if (!text) throw new Error('gemini returned an invalid response');
  return text;
}

class GeminiProvider {
  constructor(options) {
    this.name = options.name || 'gemini';
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs || 60000;
    this.fetch = options.fetchImpl || globalThis.fetch;
  }

  async answer({ text, messages }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(generationUrl(this.model), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(toGeminiRequest(messages || [{ role: 'user', content: String(text || '') }])),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${this.name} request failed with HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error(`${this.name} response is too large`);
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) throw new Error(`${this.name} response is too large`);
      return extractText(JSON.parse(raw));
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error(`${this.name} request timed out`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  GeminiProvider,
  extractText,
  generationUrl,
  toGeminiRequest,
};
