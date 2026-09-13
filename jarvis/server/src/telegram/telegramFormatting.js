const TELEGRAM_MESSAGE_LIMIT = 4000;

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatPlainMarkdown(value) {
  return escapeTelegramHtml(value)
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
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
