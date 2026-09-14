const { normalizeCommitmentText, normalizedLower } = require('./textNormalizer');

const CREATE_CUE = /(?:^|[^\p{L}\p{N}])(?:(?:я\s+)?(?:обещаю|сделаю|закончу|продолжу|позвоню|отправлю|проверю)|мне\s+(?:надо|нужно)|напомни(?:те)?|i\s+will|i'll|remind\s+me|need\s+to)(?=$|[^\p{L}\p{N}])/iu;

function parseCommitmentIntent(text, locale = 'ru-RU') {
  const original = normalizeCommitmentText(text);
  const source = normalizedLower(original, locale);
  if (/(?<![\p{L}\p{N}_])(?:отмени|не буду|cancel|never mind)(?![\p{L}\p{N}_])/iu.test(source)) return { action: 'cancel', title: original, confidence: 0.95 };
  if (/(?<![\p{L}\p{N}_])(?:перенеси|переношу|давай вместо|reschedule|move it)(?![\p{L}\p{N}_])/iu.test(source)) return { action: 'reschedule', title: original, confidence: 0.93 };
  if (/(?<![\p{L}\p{N}_])(?:исправь|поправка|я имел в виду|correction|i meant)(?![\p{L}\p{N}_])/iu.test(source)) return { action: 'correct', title: original, confidence: 0.92 };
  if (/(?<![\p{L}\p{N}_])(?:готово|сделано|выполнил|завершил|done|completed|finished)(?![\p{L}\p{N}_])/iu.test(source)) return { action: 'complete', title: original, confidence: 0.94 };
  if (CREATE_CUE.test(source)) return { action: 'create', title: cleanTitle(original), confidence: 0.9 };
  return null;
}

function cleanTitle(text) {
  return normalizeCommitmentText(text)
    .replace(/^\s*(?:напомни(?:те)?\s+(?:мне\s+)?(?:что\s+)?|remind\s+me\s+(?:to\s+)?)/iu, '')
    .slice(0, 300);
}

module.exports = { CREATE_CUE, cleanTitle, parseCommitmentIntent };
