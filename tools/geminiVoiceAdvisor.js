const crypto = require('crypto');
const https = require('https');
const { validateSttSettings } = require('../voice/sttSettings');

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_HOST = 'generativelanguage.googleapis.com';
const MAX_AUDIO_BYTES = 640000;
const MIN_REQUEST_INTERVAL_MS = 10000;
const ALLOWED_RECOMMENDATION_FIELDS = [
  'minSpeechMs',
  'silenceMs',
  'maxSegmentMs',
  'startRms',
  'continueRms',
  'preRollMs',
  'performanceProfile',
  'beamSize',
  'vadFilter',
];

function requestJson({ model, apiKey, body, timeoutMs = 30000, requestImpl = https.request }) {
  return new Promise((resolve, reject) => {
    const request = requestImpl({
      hostname: GEMINI_HOST,
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-goog-api-key': apiKey,
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(responseBody); } catch (error) {
          reject(new Error(`Gemini returned invalid JSON (${response.statusCode || 'unknown'}).`));
          return;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          const providerMessage = parsed.error && parsed.error.message ? String(parsed.error.message) : 'request failed';
          reject(new Error(`Gemini request failed: ${providerMessage.slice(0, 240)}`));
          return;
        }
        resolve(parsed);
      });
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error('Gemini request timed out.')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function extractResponseText(response) {
  const parts = response && response.candidates && response.candidates[0]
    && response.candidates[0].content && response.candidates[0].content.parts;
  if (!Array.isArray(parts)) throw new Error('Gemini response did not contain a text candidate.');
  const text = parts.map((part) => String(part.text || '')).join('').trim();
  if (!text) throw new Error('Gemini response was empty.');
  return text;
}

function parseJsonText(text) {
  const trimmed = String(text || '').trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  try { return JSON.parse(withoutFence); } catch (error) {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw new Error('Gemini response was not a JSON object.');
  }
}

function normalizeAdvisorResponse(rawResponse, currentSettings) {
  const parsed = typeof rawResponse === 'string' ? parseJsonText(rawResponse) : rawResponse;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini recommendation must be an object.');
  }
  const rawSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  const rawFasterWhisper = rawSettings.fasterWhisper && typeof rawSettings.fasterWhisper === 'object'
    ? rawSettings.fasterWhisper
    : rawSettings;
  const changes = {};
  for (const field of ALLOWED_RECOMMENDATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawFasterWhisper, field)) changes[field] = rawFasterWhisper[field];
  }
  if (Object.keys(changes).length === 0) throw new Error('Gemini returned no allowed STT changes.');

  const candidate = validateSttSettings({
    ...currentSettings,
    fasterWhisper: {
      ...currentSettings.fasterWhisper,
      ...changes,
    },
  });
  const confidence = Number(parsed.confidence);
  return {
    ok: true,
    candidate,
    changes,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    explanation: String(parsed.explanation || parsed.reason || 'Gemini предложил новый профиль.').slice(0, 600),
  };
}

function buildPrompt({ summary, settings, deep }) {
  const current = {};
  for (const field of ALLOWED_RECOMMENDATION_FIELDS) {
    current[field] = settings.fasterWhisper[field];
  }
  return [
    'Ты консультант по настройке локальной русской голосовой транскрибации Jarvis.',
    'Проанализируй только качество аудио и предложи безопасные изменения параметров.',
    'Верни только JSON: {"settings":{"fasterWhisper":{...}},"confidence":0..1,"explanation":"..."}.',
    'Разрешены только поля minSpeechMs, silenceMs, maxSegmentMs, startRms, continueRms, preRollMs, performanceProfile, beamSize, vadFilter.',
    'Не добавляй API-ключи, пути, команды, код или новые поля.',
    deep ? 'К запросу приложен короткий WAV-фрагмент для глубокого анализа.' : 'Аудио не приложено; используй только агрегированные метрики.',
    'Текущие настройки: ' + JSON.stringify(current),
    `Метрики: ${JSON.stringify(summary)}`,
  ].join('\n');

}

function pcmToWavBase64(pcmBuffer, sampleRate = 16000, channels = 1) {
  if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0 || pcmBuffer.length > MAX_AUDIO_BYTES) {
    throw new Error('Audio sample is empty or too large.');
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]).toString('base64');
}

class GeminiVoiceAdvisor {
  constructor(options = {}) {
    this.requestImpl = options.requestImpl || https.request;
    this.apiKeyResolver = options.apiKeyResolver || (() => process.env.GEMINI_API_KEY || '');
    this.now = options.now || (() => Date.now());
    this.lastRequestAt = 0;
    this.lastFingerprint = '';
  }

  getStatus(settings = {}) {
    const advisor = settings.advisor || {};
    return {
      configured: Boolean(this.apiKeyResolver()),
      mode: advisor.mode || 'problems-only',
      allowAudio: advisor.allowAudio === true,
      model: advisor.model || process.env.JARVIS_GEMINI_MODEL || DEFAULT_MODEL,
      lastRequestAt: this.lastRequestAt || null,
    };
  }

  async analyze({ settings, summary, audioPcm = null, force = false } = {}) {
    const currentSettings = validateSttSettings(settings || {});
    const advisor = currentSettings.advisor;
    const apiKey = this.apiKeyResolver();
    if (!apiKey) return { ok: false, reason: 'api-key-missing', message: 'GEMINI_API_KEY не настроен.' };
    if (audioPcm && advisor.allowAudio !== true) {
      return { ok: false, reason: 'audio-not-allowed', message: 'Отправка аудио отключена в настройках приватности.' };
    }

    const model = advisor.model || process.env.JARVIS_GEMINI_MODEL || DEFAULT_MODEL;
    if (this.lastRequestAt && this.now() - this.lastRequestAt < MIN_REQUEST_INTERVAL_MS) {
      return { ok: false, reason: 'rate-limited', message: 'Повторите запрос через несколько секунд.' };
    }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
      summary,
      current: currentSettings.fasterWhisper,
      audioLength: audioPcm ? audioPcm.length : 0,
    })).digest('hex');
    const cooldownMs = Number(advisor.cooldownMs || 1800000);
    if (!force && fingerprint === this.lastFingerprint && this.now() - this.lastRequestAt < cooldownMs) {
      return { ok: false, reason: 'cooldown', message: 'Анализ уже выполнялся для этих данных.' };
    }

    const deep = Boolean(audioPcm);
    const parts = [{ text: buildPrompt({ summary, settings: currentSettings, deep }) }];
    if (deep) parts.push({ inlineData: { mimeType: 'audio/wav', data: pcmToWavBase64(audioPcm) } });
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 300,
      },
    });

    this.lastRequestAt = this.now();
    this.lastFingerprint = fingerprint;
    try {
      const response = await requestJson({
        model,
        apiKey,
        body,
        requestImpl: this.requestImpl,
      });
      return normalizeAdvisorResponse(extractResponseText(response), currentSettings);
    } catch (error) {
      return { ok: false, reason: 'request-failed', message: error.message || 'Gemini analysis failed.' };
    }
  }
}

module.exports = {
  GeminiVoiceAdvisor,
  normalizeAdvisorResponse,
  pcmToWavBase64,
  requestJson,
  DEFAULT_MODEL,
  MAX_AUDIO_BYTES,
  MIN_REQUEST_INTERVAL_MS,
};
