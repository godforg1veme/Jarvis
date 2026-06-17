const fs = require('fs');
const path = require('path');
const { chatJson } = require('./aiClient');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'ai-settings.json');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'ai-cache.json');
const VALID_INTENTS = new Set(['open_app', 'search_app', 'unknown']);
const VALID_LANGUAGES = new Set(['ru', 'en', 'unknown']);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadSettings() {
  return loadJSON(SETTINGS_PATH, {
    enableAiIntent: true,
    useAiOnlyOnFallback: true,
  });
}

function loadCache() {
  const cache = loadJSON(CACHE_PATH, { entries: [] });
  if (!cache || typeof cache !== 'object') return { entries: [] };
  if (!Array.isArray(cache.entries)) return { entries: [] };
  return cache;
}

function normalizeCacheKey(input) {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getCachedResult(input) {
  const key = normalizeCacheKey(input);
  const cache = loadCache();
  const entry = cache.entries.find(item =>
    normalizeCacheKey(item?.input) === key || normalizeCacheKey(item?.key) === key
  );

  if (!entry || !entry.result || typeof entry.result !== 'object') return null;

  try {
    return normalizeIntentResult(entry.result);
  } catch {
    return null;
  }
}

function saveCacheResult(input, result) {
  const cache = loadCache();
  const key = normalizeCacheKey(input);
  const existingIndex = cache.entries.findIndex(item =>
    normalizeCacheKey(item?.input) === key || normalizeCacheKey(item?.key) === key
  );

  const entry = {
    key,
    input,
    result,
    createdAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    cache.entries[existingIndex] = entry;
  } else {
    cache.entries.unshift(entry);
  }

  cache.entries = cache.entries.slice(0, 200);
  saveJSON(CACHE_PATH, cache);
}

function extractJsonFromMarkdown(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}

function parseJsonResponse(text) {
  const candidates = [
    String(text || '').trim(),
    extractJsonFromMarkdown(text),
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('AI вернул невалидный JSON. Проверьте system prompt и модель OpenRouter.');
}

function normalizeLanguage(value) {
  const normalized = String(value || '').toLowerCase();
  return VALID_LANGUAGES.has(normalized) ? normalized : 'unknown';
}

function normalizeConfidence(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(1, numberValue));
}

function normalizeExpandedQueries(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const queries = [];

  for (const item of value) {
    const query = String(item || '').trim().replace(/\s+/g, ' ');
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
    if (queries.length >= 8) break;
  }

  return queries;
}

function normalizeIntentResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI вернул JSON, но это не объект.');
  }

  const intent = VALID_INTENTS.has(raw.intent) ? raw.intent : 'unknown';
  const original = typeof raw.original === 'string' ? raw.original.trim() : '';
  const appQuery = typeof raw.appQuery === 'string' ? raw.appQuery.trim() : '';
  const expandedQueries = normalizeExpandedQueries(raw.expandedQueries);
  const language = normalizeLanguage(raw.language);
  const confidence = normalizeConfidence(raw.confidence);
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';

  if ((intent === 'open_app' || intent === 'search_app') && expandedQueries.length === 0 && appQuery) {
    expandedQueries.push(appQuery);
  }

  const lowerOriginal = original.toLowerCase();
  if (lowerOriginal.includes('приложение для сайтов')) {
    for (const query of ['google chrome', 'firefox', 'mozilla firefox', 'microsoft edge']) {
      if (!expandedQueries.includes(query)) expandedQueries.push(query);
    }
  }

  if (lowerOriginal.includes('приложение для кода')) {
    for (const query of ['visual studio code', 'vscode', 'vs code', 'code']) {
      if (!expandedQueries.includes(query)) expandedQueries.push(query);
    }
  }

  return {
    intent,
    original,
    appQuery,
    expandedQueries,
    language,
    confidence,
    reason,
  };
}

function buildMessages(originalInput) {
  return [
    {
      role: 'system',
      content: `Ты модуль разбора намерений для локального Windows launcher. Не выполняй команды. Не придумывай пути к exe. Верни только JSON. Твоя задача — понять, какое приложение пользователь хочет открыть, и дать варианты названия для поиска в локальном индексе.

Верни строго JSON:
{
  "intent": "open_app" | "search_app" | "unknown",
  "original": "...",
  "appQuery": "...",
  "expandedQueries": ["..."],
  "language": "ru" | "en" | "unknown",
  "confidence": 0.0,
  "reason": "..."
}

Правила:
- "дота", "дотка" → dota 2
- "кс", "контра" → counter-strike 2, cs2
- "хром", "браузер от гугла" → google chrome, chrome
- "вскод", "редактор кода" → visual studio code, vscode, code
- "фотошоп" → adobe photoshop, photoshop
- "браузер от мозиллы" → firefox, mozilla firefox
- Для общего запроса "приложение для сайтов" возвращай только браузерные candidates, например google chrome, firefox, microsoft edge.
- Для общего запроса "приложение для кода" возвращай visual studio code, vscode, code.
- Не возвращай команды PowerShell.
- Не возвращай команды cmd/command/exe/steam как действия для выполнения.
- Не возвращай path к exe.
- Не возвращай markdown, пояснения или код вне JSON.
- Если не уверен, intent = "unknown", confidence <= 0.5.`,
    },
    {
      role: 'user',
      content: String(originalInput || '').trim(),
    },
  ];
}

async function resolveIntentWithAi(originalInput) {
  const input = String(originalInput || '').trim();
  if (!input) {
    throw new Error('Пустой запрос для AI intent resolver.');
  }

  const cached = getCachedResult(input);
  if (cached) {
    return cached;
  }

  const settings = loadSettings();
  if (!settings.enableAiIntent) {
    throw new Error('AI intent resolver отключён в data/ai-settings.json.');
  }

  if (!process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY.trim() === '') {
    throw new Error('OPENROUTER_API_KEY не задан. AI fallback недоступен; локальный поиск продолжен.');
  }

  const content = await chatJson(buildMessages(input));
  const parsed = parseJsonResponse(content);
  const result = normalizeIntentResult(parsed);

  saveCacheResult(input, result);
  return result;
}

module.exports = {
  resolveIntentWithAi,
  parseJsonResponse,
  normalizeIntentResult,
};