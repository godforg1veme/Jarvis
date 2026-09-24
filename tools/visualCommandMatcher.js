const ANALYZE_PHRASES = [
  'посмотри сюда',
  'что здесь',
  'что тут',
  'объясни это',
  'что тут не так',
  'что за ошибка',
];

const CONTINUATION_PHRASES = [
  'что делать',
  'почему',
  'объясни подробнее',
  'а дальше',
  'как исправить',
  'переведи это',
  'что это значит',
];

const CLEAR_PHRASES = [
  'забудь это',
  'забудь экран',
  'очисти визуальный контекст',
  'очисти visual context',
  'сбрось визуальный контекст',
];
const { classifyVisualIntent } = require('../vision/visualIntent');

function normalizeVisualCommandText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesPhrase(text, phrases) {
  const normalized = normalizeVisualCommandText(text);
  return phrases.some((phrase) => normalized.includes(normalizeVisualCommandText(phrase)));
}

function isVisualAnalyzeCommand(text) {
  return classifyVisualIntent(text).visual || includesPhrase(text, ANALYZE_PHRASES);
}

function isVisualContinuationCommand(text) {
  return includesPhrase(text, CONTINUATION_PHRASES);
}

function isClearVisualContextCommand(text) {
  return includesPhrase(text, CLEAR_PHRASES);
}

module.exports = {
  ANALYZE_PHRASES,
  CONTINUATION_PHRASES,
  CLEAR_PHRASES,
  normalizeVisualCommandText,
  isVisualAnalyzeCommand,
  isVisualContinuationCommand,
  isClearVisualContextCommand,
};
