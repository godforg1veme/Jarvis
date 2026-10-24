const MAX_RESPONSE_BYTES = 256 * 1024;
const { isIP } = require('node:net');
const MAX_QUERY_LENGTH = 512;
const NEUTRAL_SEARCH_WORDS = new Set(('official documentation docs reference current latest today news prices price schedule ' +
  'официальный официальная официальные официальный сайт документация документации справка актуальный актуальная актуальные ' +
  'последние новости цена цены стоимость расписание сегодня сейчас условия версия версии').split(' '));
const words = (value) => String(value).toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || [];
function hasPhoneNumber(value) {
  return (String(value).match(/\+?\d[\d\s().-]{7,}\d/g) || [])
    .some((candidate) => candidate.replace(/\D/g, '').length >= 10);
}

function publicSearchRequest(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) return false;
  // Do not send document excerpts or self-identification through the search planner.
  return !/(?:меня зовут|моя фамилия|мои (?:личные|персональные) данные|моя переписка|вот (?:мое|моё) резюме|my name is|my private|sourceLetter|ownerEditRequest|approvedStyleExamples|(?:^|\n)\s*(?:опыт работы|контактные данные|факт|пример)\s*[:：])/iu.test(value)
    && !hasPhoneNumber(value)
    && !/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:Bearer\s+\S+|tvly-[\w-]{8,}|sk-[\w-]{12,})|(?:пароль|токен|password|secret|api[_ -]?key)\s*[:=]\s*\S+/iu.test(value);
}

function groundedQuery(query, currentRequest) {
  const safe = safeQuery(query);
  if (!safe || !publicSearchRequest(currentRequest)) return null;
  const requestWords = new Set(words(currentRequest));
  const queryWords = words(safe);
  return queryWords.some((word) => word.length > 1 && requestWords.has(word))
    && queryWords.every((word) => requestWords.has(word) || NEUTRAL_SEARCH_WORDS.has(word)) ? safe : null;
}

function safeQuery(value) {
  if (typeof value !== 'string') return null;
  const query = value.trim().replace(/\s+/g, ' ');
  if (!query || query.length > MAX_QUERY_LENGTH || /[\r\n<>]/.test(query)) return null;
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(query) || hasPhoneNumber(query)) return null;
  if (/\bsk-[\w-]{12,}|(?:api[_ -]?key|token|password|secret|пароль|токен)\s*[:=]\s*\S+/iu.test(query)) return null;
  if (/\bBearer\s+\S+|\b(?:gh[pousr]_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{12,}|tvly-[\w-]{8,})\S*/i.test(query)) return null;
  if (/https?:\/\/\S+/i.test(query)) return null;
  if (/\b(?:localhost|[a-z0-9.-]+\.(?:local|internal|lan))(?:[/:]\S*)?\b/i.test(query)) return null;
  if (/\b(?:127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?:[:/]\S*)?\b/.test(query)) return null;
  return query;
}

function publicUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    for (const name of url.searchParams.keys()) {
      if (/(?:token|password|secret|credential|signature|authorization|session|api[_-]?key|^sid$|^key$|^sig$|^auth$|^x-amz-)/i.test(name)) return null;
    }
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || isIP(host.replace(/^\[|\]$/g, ''))) return null;
    return url.href;
  } catch { return null; }
}

function normalizeSources(value) {
  const rows = Array.isArray(value?.results) ? value.results : Array.isArray(value?.sources) ? value.sources : [];
  return rows.slice(0, 5).map((row) => ({
    title: String(row?.title || '').trim().slice(0, 300),
    url: publicUrl(row?.url),
    excerpt: String(row?.content || row?.excerpt || '').trim().slice(0, 2000),
  })).filter((row) => row.title && row.url && row.excerpt).map((row, index) => ({ id: `W${index + 1}`, ...row }));
}

module.exports = { MAX_RESPONSE_BYTES, safeQuery, groundedQuery, publicSearchRequest, normalizeSources };
