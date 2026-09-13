const crypto = require('crypto');

const LEADING_WAKE_WORDS = new Set(['джарвис', 'jarvis']);
const LEADING_LAUNCH_WORDS = new Set([
  'открой', 'открыть', 'запусти', 'запустить', 'запуск',
  'open', 'run', 'launch', 'start',
]);

function normalizeAlias(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactAlias(value) {
  return normalizeAlias(value).replace(/\s+/g, '');
}

function stripLaunchTrigger(value) {
  const tokens = normalizeAlias(value).split(' ').filter(Boolean);
  while (tokens.length > 0 && LEADING_WAKE_WORDS.has(tokens[0])) tokens.shift();
  if (tokens.length > 0 && LEADING_LAUNCH_WORDS.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

function uniqueAliases(values, options = {}) {
  const maxAliases = Number.isFinite(options.maxAliases) ? options.maxAliases : 8;
  const minLength = Number.isFinite(options.minLength) ? options.minLength : 2;
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : 80;
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(values) ? values : []) {
    const alias = normalizeAlias(value);
    if (alias.length < minLength || alias.length > maxLength || seen.has(alias)) continue;
    seen.add(alias);
    result.push(alias);
    if (result.length >= maxAliases) break;
  }

  return result;
}

function stableId(prefix, value) {
  const digest = crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}

function stemRussianToken(token) {
  if (!/^[а-яё]+$/i.test(token) || token.length <= 3) return token;
  const t = token.toLowerCase().replace(/ё/g, 'е');
  if (t.endsWith('ами') || t.endsWith('ями') || t.endsWith('иями')) return t.slice(0, -3);
  if (t.endsWith('ой') || t.endsWith('ей') || t.endsWith('ом') || t.endsWith('ем') || t.endsWith('ам') || t.endsWith('ям') || t.endsWith('ах') || t.endsWith('ях')) return t.slice(0, -2);
  if (t.endsWith('а') || t.endsWith('я') || t.endsWith('у') || t.endsWith('ю') || t.endsWith('е') || t.endsWith('и') || t.endsWith('ы') || t.endsWith('о')) return t.slice(0, -1);
  return t;
}

function stemRussianPhrase(phrase) {
  return normalizeAlias(phrase).split(' ').filter(Boolean).map(stemRussianToken).join(' ');
}

module.exports = {
  normalizeAlias,
  compactAlias,
  stripLaunchTrigger,
  stemRussianToken,
  stemRussianPhrase,
  uniqueAliases,
  stableId,
};
