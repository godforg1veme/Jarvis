const TELEGRAM_MESSAGE_LIMIT = 4000;

const ALLOWED_TELEGRAM_TAGS_RE = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|code|pre|blockquote)\b[^>]*>|<a\s+href="https?:\/\/[^"]*"[^>]*>|<\/a>/gi;

function escapeTelegramHtml(value) {
  const text = String(value || '');
  const placeholders = [];
  const protectedText = text.replace(ALLOWED_TELEGRAM_TAGS_RE, (match) => {
    placeholders.push(match);
    return `\x00TAG_${placeholders.length - 1}\x00`;
  });
  const escaped = protectedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return placeholders.length
    ? escaped.replace(/\x00TAG_(\d+)\x00/g, (_, index) => placeholders[Number(index)])
    : escaped;
}

function formatPlainMarkdown(value) {
  return escapeTelegramHtml(value)
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');
}

function formatTelegramHtml(markdown) {
  const source = String(markdown || '');
  const codePattern = /```(?:[^\n`]*)\n?([\s\S]*?)```|`([^`\n]+)`/g;
  let result = '';
  let offset = 0;
  let match;

  while ((match = codePattern.exec(source)) !== null) {
    result += formatPlainMarkdown(source.slice(offset, match.index));
    const code = escapeTelegramHtml(match[1] !== undefined ? match[1] : match[2]);
    result += match[1] !== undefined ? `<pre><code>${code}</code></pre>` : `<code>${code}</code>`;
    offset = match.index + match[0].length;
  }

  return result + formatPlainMarkdown(source.slice(offset));
}

function splitTelegramText(text, maxLength = TELEGRAM_MESSAGE_LIMIT) {
  const chunks = [];
  let remaining = String(text || '');
  while (remaining.length > maxLength) {
    let boundary = remaining.lastIndexOf('\n', maxLength);
    if (boundary < Math.floor(maxLength / 2)) boundary = remaining.lastIndexOf(' ', maxLength);
    if (boundary < Math.floor(maxLength / 2)) boundary = maxLength;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendTelegramText(send, text, finalOptions = {}) {
  const chunks = splitTelegramText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    await send(formatTelegramHtml(chunks[index]), {
      parse_mode: 'HTML',
      ...(index === chunks.length - 1 ? finalOptions : {}),
    });
  }
}

module.exports = {
  TELEGRAM_MESSAGE_LIMIT,
  escapeTelegramHtml,
  formatTelegramHtml,
  sendTelegramText,
  splitTelegramText,
};
