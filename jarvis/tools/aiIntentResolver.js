const fs = require('fs');
const path = require('path');
const { chatJson: defaultChatJson, isHeaderSafeApiKey } = require('./aiClient');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'ai-settings.json');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'ai-cache.json');
const SCHEMA_VERSION = 2;
const DEFAULT_MIN_CONFIDENCE = 0.75;

const DIRECT_ACTIONS = new Set([
  'launch_app',
  'search_app',
  'close_app',
  'open_file',
  'reveal_file',
  'find_file',
  'translate_selected',
]);
const FILE_ACTIONS = new Set(['open_file', 'reveal_file', 'find_file']);
const APP_ACTIONS = new Set(['launch_app', 'search_app', 'close_app']);
const KNOWN_LOCATIONS = new Set([
  'desktop', 'downloads', 'documents', 'pictures', 'videos', 'music', 'home', 'computer',
]);
const FORBIDDEN_MODEL_FIELDS = new Set([
  'path', 'paths', 'exepath', 'executable', 'command', 'commandline', 'powershell',
  'shell', 'tool', 'toolcall', 'tool_calls', 'args',
]);
const ALLOWED_MODEL_FIELDS = new Set([
  'schemaVersion', 'route', 'action', 'appQuery', 'query', 'location',
  'confidence', 'reason',
]);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function saveJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadSettings() {
  return loadJSON(SETTINGS_PATH, {
    provider: 'openrouter',
    textModel: 'openrouter/free',
    enableAiIntent: true,
    useAiOnlyOnFallback: true,
  });
}

function normalizeText(input) {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCapabilities(value) {
  const source = Array.isArray(value) && value.length > 0 ? value : Array.from(DIRECT_ACTIONS);
  return Array.from(new Set(source.filter((action) => DIRECT_ACTIONS.has(action)))).sort();
}

function cacheIdentity(input, options = {}) {
  const model = String(options.model || 'openrouter/free').trim();
  const mode = String(options.mode || 'default').trim().toLowerCase() || 'default';
  const capabilities = normalizeCapabilities(options.capabilities).join(',');
  return `v${SCHEMA_VERSION}:${mode}:${model}:${capabilities}:${normalizeText(input)}`;
}

function loadCache(cachePath = CACHE_PATH) {
  const cache = loadJSON(cachePath, { entries: [] });
  if (!cache || typeof cache !== 'object' || !Array.isArray(cache.entries)) return { entries: [] };
  return cache;
}

function getCachedResult(input, options = {}) {
  if (options.cache === false) return null;
  const key = cacheIdentity(input, options);
  const entry = loadCache(options.cachePath || CACHE_PATH).entries.find(
    (item) => item && item.schemaVersion === SCHEMA_VERSION && item.key === key,
  );
  if (!entry || !entry.result || typeof entry.result !== 'object') return null;
  return normalizeCommandResult(entry.result, options);
}

function saveCacheResult(input, result, options = {}) {
  if (options.cache === false) return;
  const cachePath = options.cachePath || CACHE_PATH;
  const cache = loadCache(cachePath);
  const key = cacheIdentity(input, options);
  const entry = {
    schemaVersion: SCHEMA_VERSION,
    key,
    input: String(input || '').trim(),
    result,
    createdAt: new Date().toISOString(),
  };
  const index = cache.entries.findIndex((item) => item && item.key === key);
  if (index >= 0) cache.entries[index] = entry;
  else cache.entries.unshift(entry);
  cache.entries = cache.entries.slice(0, 200);
  saveJSON(cachePath, cache);
}

function extractJsonFromMarkdown(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1).trim();
  return trimmed;
}

function parseJsonResponse(text) {
  const candidates = [String(text || '').trim(), extractJsonFromMarkdown(text)]
    .filter((value, index, values) => value && values.indexOf(value) === index);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next representation.
    }
  }
  throw new Error('AI вернул невалидный JSON.');
}

function unknownResult(reason, confidence = 0) {
  return {
    schemaVersion: SCHEMA_VERSION,
    route: 'unknown',
    action: null,
    appQuery: '',
    query: '',
    location: '',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reason: String(reason || 'Команда не распознана уверенно.').trim(),
    source: 'openrouter',
  };
}

function containsForbiddenField(raw) {
  return Object.keys(raw).some((key) => FORBIDDEN_MODEL_FIELDS.has(String(key).toLowerCase()));
}

function containsUnexpectedField(raw) {
  return Object.keys(raw).some((key) => !ALLOWED_MODEL_FIELDS.has(key));
}

function isUnsafeAppQuery(value) {
  const query = String(value || '').trim().toLowerCase();
  if (!query) return true;
  if (query.includes('\\') || query.includes('/') || query.endsWith('.exe')) return true;
  return ['powershell', 'cmd', 'cmd.exe', 'command prompt'].includes(query);
}

function isUnsafeFileQuery(value) {
  const query = String(value || '').trim();
  if (!query) return true;
  return query.includes('\\') || query.includes('/') || /^[a-z]:/i.test(query);
}

function normalizeCommandResult(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return unknownResult('AI вернул JSON, но это не объект.');
  }
  if (containsForbiddenField(raw)) {
    return unknownResult('AI вернул запрещённое поле пути, команды или инструмента.');
  }
  if (containsUnexpectedField(raw)) {
    return unknownResult('AI вернул поле, которого нет в schema v2.');
  }
  if (Number(raw.schemaVersion) !== SCHEMA_VERSION) {
    return unknownResult('AI вернул неподдерживаемую версию схемы.');
  }

  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return unknownResult('AI вернул некорректную уверенность.');
  }
  const minConfidence = Number.isFinite(Number(options.minConfidence))
    ? Number(options.minConfidence)
    : DEFAULT_MIN_CONFIDENCE;
  const route = String(raw.route || '').trim().toLowerCase();
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';

  if (route === 'unknown') return unknownResult(reason, confidence);
  if (confidence < minConfidence) return unknownResult(reason || 'Недостаточная уверенность AI.', confidence);
  if (route === 'desktop_agent') {
    if (options.allowDesktopAgent === false) return unknownResult('Desktop Agent недоступен для этого вызова.', confidence);
    return { ...unknownResult(reason, confidence), route: 'desktop_agent' };
  }
  if (route !== 'direct') return unknownResult('AI вернул неизвестный маршрут.', confidence);

  const action = String(raw.action || '').trim().toLowerCase();
  const capabilities = new Set(normalizeCapabilities(options.capabilities));
  if (!DIRECT_ACTIONS.has(action) || !capabilities.has(action)) {
    return unknownResult('AI вернул неподдерживаемое действие.', confidence);
  }

  const result = {
    schemaVersion: SCHEMA_VERSION,
    route: 'direct',
    action,
    appQuery: '',
    query: '',
    location: '',
    confidence,
    reason,
    source: 'openrouter',
  };

  if (APP_ACTIONS.has(action)) {
    if (typeof raw.appQuery !== 'string') return unknownResult('AI не вернул строковое название приложения.', confidence);
    if (isUnsafeAppQuery(raw.appQuery)) return unknownResult('AI вернул небезопасное название приложения.', confidence);
    result.appQuery = String(raw.appQuery).trim().replace(/\s+/g, ' ');
  }
  if (FILE_ACTIONS.has(action)) {
    if (typeof raw.query !== 'string') return unknownResult('AI не вернул строковый файловый запрос.', confidence);
    if (raw.location !== undefined && typeof raw.location !== 'string') {
      return unknownResult('AI вернул некорректное место поиска.', confidence);
    }
    if (isUnsafeFileQuery(raw.query)) return unknownResult('AI вернул небезопасный файловый запрос.', confidence);
    const location = String(raw.location || 'computer').trim().toLowerCase();
    if (!KNOWN_LOCATIONS.has(location)) return unknownResult('AI вернул неизвестное место поиска.', confidence);
    result.query = String(raw.query).trim().replace(/\s+/g, ' ');
    result.location = location;
  }
  return result;
}

function buildMessages(originalInput, options = {}) {
  const capabilities = normalizeCapabilities(options.capabilities);
  const directActions = capabilities.length > 0 ? capabilities.join(', ') : 'none';
  const desktopAgentRule = options.allowDesktopAgent === false
    ? 'Маршрут desktop_agent запрещён для этого запроса.'
    : 'Используй desktop_agent для многошаговых, пакетных или зависимых действий.';
  return [
    {
      role: 'system',
      content: `Ты модуль нормализации команд локального Windows-ассистента Jarvis. Не выполняй команды и не вызывай инструменты. Верни только один JSON-объект без markdown.

Схема:
{
  "schemaVersion": 2,
  "route": "direct" | "desktop_agent" | "unknown",
  "action": "одно из разрешённых действий или null",
  "appQuery": "только название приложения без пути",
  "query": "только имя файла или папки без пути",
  "location": "desktop|downloads|documents|pictures|videos|music|home|computer",
  "confidence": 0.0,
  "reason": "краткая причина"
}

Разрешённые direct actions: ${directActions}.
${desktopAgentRule}

Правила безопасности:
- Никогда не возвращай path, executable, command, commandLine, shell, PowerShell, tool, args или tool calls.
- Для приложений возвращай только appQuery.
- Для файлов возвращай только имя в query и известный location, без абсолютного или относительного пути.
- Если действие не входит в разрешённый список или ты не уверен, верни route=unknown и confidence <= 0.5.
- Не добавляй пояснения вне JSON.`,
    },
    { role: 'user', content: String(originalInput || '').trim() },
  ];
}

async function resolveCommandWithAi(originalInput, options = {}) {
  const input = String(originalInput || '').trim();
  if (!input) throw new Error('Пустой запрос для AI intent resolver.');
  const settings = options.settings || loadSettings();
  if (settings.enableAiIntent === false) throw new Error('AI intent resolver отключён в data/ai-settings.json.');
  if (settings.provider && String(settings.provider).toLowerCase() !== 'openrouter') {
    throw new Error('Для простого AI fallback поддерживается только OpenRouter.');
  }
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.OPENROUTER_API_KEY;
  if (!isHeaderSafeApiKey(apiKey)) {
    throw new Error('OPENROUTER_API_KEY не задан или имеет неверный формат. AI fallback недоступен; локальные команды продолжают работать.');
  }

  const resolverOptions = { ...options, model: options.model || settings.textModel || 'openrouter/free' };
  const cached = getCachedResult(input, resolverOptions);
  if (cached) return cached;

  const transport = options.chatJson || defaultChatJson;
  const configuredFallbacks = Array.isArray(options.fallbackModels)
    ? options.fallbackModels
    : settings.fallbackModels;
  const models = Array.from(new Set([
    resolverOptions.model,
    ...(Array.isArray(configuredFallbacks) ? configuredFallbacks : []),
  ].map((model) => String(model || '').trim()).filter(Boolean)));
  let lastError = null;

  for (const model of models) {
    try {
      const content = await transport(buildMessages(input, resolverOptions), {
        model,
        timeoutMs: settings.timeoutMs,
        maxRetries: settings.maxRetries,
      });
      const result = normalizeCommandResult(parseJsonResponse(content), resolverOptions);
      saveCacheResult(input, result, resolverOptions);
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('OpenRouter AI fallback не вернул ответ.');
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_MIN_CONFIDENCE,
  DIRECT_ACTIONS,
  KNOWN_LOCATIONS,
  resolveCommandWithAi,
  parseJsonResponse,
  normalizeCommandResult,
  normalizeCapabilities,
  cacheIdentity,
  buildMessages,
};
