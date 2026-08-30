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

module.exports = {
  normalizeAlias,
  compactAlias,
  stripLaunchTrigger,
  uniqueAliases,
  stableId,
};
