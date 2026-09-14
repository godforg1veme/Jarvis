function normalizeCommitmentText(value) {
  return String(value || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 4000);
}

function normalizedLower(value, locale = 'ru-RU') {
  return normalizeCommitmentText(value).toLocaleLowerCase(locale);
}

module.exports = { normalizeCommitmentText, normalizedLower };
