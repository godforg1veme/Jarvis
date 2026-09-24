class AsrUnavailableError extends Error {
  constructor() {
    super('speech recognition is unavailable');
    this.name = 'AsrUnavailableError';
    this.statusCode = 503;
    this.publicCode = 'ASR_UNAVAILABLE';
  }
}

class DisabledAsrProvider {
  async transcribe() {
    throw new AsrUnavailableError();
  }
}

function fileNameForMimeType(mimeType) {
  const normalized = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (normalized === 'audio/ogg' || normalized === 'audio/opus' || normalized === 'application/ogg') {
    return 'utterance.ogg';
  }
  return 'utterance.wav';
}

class OpenAiCompatibleAsrProvider {
  constructor(options) {
    this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = String(options.apiKey || '');
    this.model = String(options.model || '');
    this.timeoutMs = Number(options.timeoutMs || 60000);
    this.fetch = options.fetch || globalThis.fetch;
  }

  async transcribe({ audio, mimeType, languageHint = 'ru' }) {
    if (!this.baseUrl || !this.model || !this.fetch) throw new AsrUnavailableError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const form = new FormData();
      form.set('model', this.model);
      if (languageHint) form.set('language', String(languageHint).slice(0, 12));
      form.set('response_format', 'verbose_json');
      form.set('file', new Blob([audio], { type: mimeType }), fileNameForMimeType(mimeType));
      const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
      const response = await this.fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new AsrUnavailableError();
      const body = await response.json();
      const text = String(body && body.text || '').trim();
      if (!text || text.length > 10000) throw new AsrUnavailableError();
      return {
        text,
        language: String(body.language || languageHint || '').slice(0, 12),
        confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : null,
        durationMs: Number.isFinite(Number(body.duration)) ? Math.round(Number(body.duration) * 1000) : null,
      };
    } catch (error) {
      if (error instanceof AsrUnavailableError) throw error;
      throw new AsrUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}

function createAsrProvider(config, options = {}) {
  if (config.asrProvider === 'openai-compatible') {
    return new OpenAiCompatibleAsrProvider({
      baseUrl: config.asrBaseUrl,
      apiKey: config.asrApiKey,
      model: config.asrModel,
      timeoutMs: config.asrTimeoutMs,
      fetch: options.fetch,
    });
  }
  return new DisabledAsrProvider();
}

module.exports = {
  AsrUnavailableError,
  DisabledAsrProvider,
  fileNameForMimeType,
  OpenAiCompatibleAsrProvider,
  createAsrProvider,
};
