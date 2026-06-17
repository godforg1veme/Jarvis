const { normalizeLocation } = require('./fileLocations');

function cleanText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"]/g, '')
    .replace(/[,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripWakeWord(text) {
  return String(text || '').replace(/^(джарвис|jarvis)\s+/i, '').trim();
}

function detectAction(text) {
  if (/^(покажи|показать|show|reveal)(\s|$)/.test(text)) return 'reveal';
  if (/^(найди|найти|поиск|ищи|find|search)(\s|$)/.test(text)) return 'find';
  if (/^(открой|открыть|open)(\s|$)/.test(text)) return 'open';
  return '';
}

function stripAction(text) {
  return stripWakeWord(text)
    .replace(/^(открой|открыть|покажи|показать|найди|найти|поиск|ищи|open|show|reveal|find|search)\s+/i, '')
    .replace(/^файл\s+/i, '')
    .trim();
}

function parseFileCommand(rawText) {
  const text = cleanText(rawText);
  const withoutWake = stripWakeWord(text);
  const action = detectAction(withoutWake);
  if (!action) return null;

  const location = normalizeLocation(text) || 'computer';
  let query = stripAction(text);

  const locationPhrases = [
    'на рабочем столе',
    'рабочем столе',
    'рабочий стол',
    'в загрузках',
    'загрузках',
    'загрузки',
    'в документах',
    'документах',
    'документы',
    'в изображениях',
    'изображениях',
    'изображения',
    'в видео',
    'в музыке',
    'музыке',
    'музыка',
    'в домашней папке',
    'домашней папке',
    'домашняя папка',
    'на компьютере',
    'на пк',
    'везде',
    'не помню где',
  ];

  for (const phrase of locationPhrases) {
    query = query.replace(phrase, ' ');
  }

  query = query.replace(/\b(в|на)\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (!query) return null;

  return { action, query, location };
}

function isFileCommand(rawText) {
  return !!parseFileCommand(rawText);
}

module.exports = {
  cleanText,
  stripWakeWord,
  parseFileCommand,
  isFileCommand,
};
