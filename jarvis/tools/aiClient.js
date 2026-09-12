const fs = require('fs');
const path = require('path');
const { getWritableDataPath } = require('../runtimeDataPath');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'ai-settings.json');
const ENDPOINT_PATH = '/chat/completions';

function isHeaderSafeApiKey(value) {
  const token = String(value || '');
  return token.length > 0 && token === token.trim() && /^[\x21-\x7e]+$/.test(token);
}

function loadSettings() {
  try {
    const target = getWritableDataPath(SETTINGS_PATH);
    if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf-8'));
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return {};
  } catch {
    return {};
  }
}

function normalizeOpenRouterModel(model) {
  if (!model || String(model).trim() === '' || String(model).trim() === 'free') {
    return 'openrouter/free';
  }
  return String(model).trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfter(value) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 60000);
  }

  return null;
}

function getErrorMessageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';

  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  if (typeof payload.message === 'string') return payload.message;

  return '';
}

function formatOpenRouterError(status, statusText, payload) {
  const message = getErrorMessageFromPayload(payload);
  const detail = message ? ` ${message}` : '';

  if (status === 401 || status === 403) {
    return `OpenRouter API key отсутствует или неверный (${status}).${detail}`;
  }

  if (status === 429) {
    return `OpenRouter rate limit (${status}).${detail}`;
  }

  if ([502, 503, 504].includes(status)) {
    return `OpenRouter временно недоступен (${status}).${detail}`;
  }

  if (status === 400 || status === 404) {
    return `OpenRouter запрос не принят (${status}).${detail}`;
  }

  return `OpenRouter вернул ошибку ${status} ${statusText || ''}.${detail}`.trim();
}

function validateAndSanitizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('AI fallback требует непустой массив messages.');
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new Error(`AI fallback message #${index + 1} должен быть объектом.`);
    }

    const { content, ...rest } = message;

    if (typeof content === 'string') {
      return { ...rest, role: message.role || 'user', content };
    }

    if (Array.isArray(content)) {
      const imagePart = content.find(part => part && typeof part === 'object' && part.type === 'image_url');
      if (imagePart) {
        throw new Error('AI fallback сейчас поддерживает только текстовые запросы.');
      }

      const textParts = content
        .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof (part.text || part.content) === 'string')
        .map(part => part.text || part.content);

      if (textParts.length === 0) {
        throw new Error(`AI fallback message #${index + 1} не содержит текстового content.`);
      }

      return { ...rest, role: message.role || 'user', content: textParts.join('\n') };
    }

    if (content && typeof content === 'object' && content.type === 'image_url') {
      throw new Error('AI fallback сейчас поддерживает только текстовые запросы.');
    }

    if (content && typeof content === 'object' && content.type === 'text' && typeof (content.text || content.content) === 'string') {
      return { ...rest, role: message.role || 'user', content: content.text || content.content };
    }

    throw new Error(`AI fallback message #${index + 1} должен содержать только текст.`);
  });
}

function validateAndSanitizeVisionMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Vision AI request requires a non-empty messages array.');
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new Error(`Vision AI message #${index + 1} must be an object.`);
    }

    const role = message.role || 'user';
    const content = message.content;

    if (typeof content === 'string') {
      return { role, content };
    }

    if (!Array.isArray(content)) {
      throw new Error(`Vision AI message #${index + 1} must contain text or multimodal content.`);
    }

    const parts = content.map((part, partIndex) => {
      if (!part || typeof part !== 'object') {
        throw new Error(`Vision AI message #${index + 1} part #${partIndex + 1} must be an object.`);
      }

      if (part.type === 'text') {
        const text = typeof part.text === 'string' ? part.text : part.content;
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error(`Vision AI message #${index + 1} has an empty text part.`);
        }
        return { type: 'text', text };
      }

      if (part.type === 'image_url') {
        const imageUrl = part.image_url;
        const url = typeof imageUrl === 'string' ? imageUrl : imageUrl?.url;
        if (typeof url !== 'string' || !url.startsWith('data:image/')) {
          throw new Error(`Vision AI message #${index + 1} has an invalid image_url part.`);
        }
        return { type: 'image_url', image_url: { url } };
      }

      throw new Error(`Vision AI message #${index + 1} has an unsupported content part: ${part.type || 'unknown'}.`);
    });

    return { role, content: parts };
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const callerSignal = options && options.signal;
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else if (callerSignal) callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', abortFromCaller);
  }
}

async function requestOpenRouterChat(messages, options = {}) {
  const settings = loadSettings();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!isHeaderSafeApiKey(apiKey)) {
    throw new Error('OPENROUTER_API_KEY не задан или имеет неверный формат. AI fallback недоступен.');
  }

  const baseUrl = String(settings.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const model = normalizeOpenRouterModel(options.model || settings.textModel);
  const timeoutMs = Number(options.timeoutMs || settings.timeoutMs || 30000);
  const maxRetries = Number.isInteger(Number(settings.maxRetries)) ? Number(settings.maxRetries) : 2;
  const url = `${baseUrl}${ENDPOINT_PATH}`;
  const body = {
    model,
    messages,
    temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0,
  };

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    let payload = null;

    try {
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Jarvis',
        },
        body: JSON.stringify(body),
        signal: options.signal,
      }, timeoutMs);

      const responseText = await response.text();
      try {
        payload = responseText ? JSON.parse(responseText) : null;
      } catch {
        payload = null;
      }

      if (response.ok) {
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.trim() === '') {
          throw new Error('OpenRouter вернул ответ без текстового сообщения.');
        }
        return content;
      }

      const error = new Error(formatOpenRouterError(response.status, response.statusText, payload));
      lastError = error;

      if (![429, 502, 503, 504].includes(response.status) || attempt >= maxRetries) {
        throw error;
      }

      const retryDelayMs = response.status === 429
        ? Math.min(
          Math.max(
            Number(payload?.retry_after_seconds || parseRetryAfter(response.headers.get('Retry-After')) || 1) * 1000,
            500
          ),
          60000
        )
        : Math.min(1000 * (2 ** attempt), 5000);

      await sleep(retryDelayMs);
    } catch (err) {
      if (!response || err.message !== lastError?.message) {
        lastError = err;
      }

      if (attempt >= maxRetries) {
        throw lastError;
      }

      if (![429, 502, 503, 504].includes(response?.status || 0)) {
        throw err;
      }

      const retryDelayMs = response?.status === 429
        ? Math.min(
          Math.max(
            Number(payload?.retry_after_seconds || parseRetryAfter(response.headers.get('Retry-After')) || 1) * 1000,
            500
          ),
          60000
        )
        : Math.min(1000 * (2 ** attempt), 5000);

      await sleep(retryDelayMs);
    }
  }

  throw lastError || new Error('OpenRouter запрос не выполнен.');
}

function resolveVisionModel(options = {}) {
  const settings = loadSettings();
  return String(
    options.model ||
    process.env.OPENROUTER_VISION_MODEL ||
    settings.visionModel ||
    'openrouter/auto'
  ).trim();
}

async function chatJson(messages, options = {}) {
  const safeMessages = validateAndSanitizeMessages(messages);
  const settings = loadSettings();
  const model = normalizeOpenRouterModel(options.model || settings.textModel);

  return await requestOpenRouterChat(safeMessages, {
    ...options,
    model,
  });
}

async function chatVision(messages, options = {}) {
  const safeMessages = validateAndSanitizeVisionMessages(messages);
  const model = resolveVisionModel(options);

  return await requestOpenRouterChat(safeMessages, {
    ...options,
    model,
  });
}

module.exports = {
  chatJson,
  chatVision,
  isHeaderSafeApiKey,
  normalizeOpenRouterModel,
  resolveVisionModel,
};
