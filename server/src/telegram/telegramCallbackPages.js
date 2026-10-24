const { randomUUID } = require('node:crypto');

const PAGE_CALLBACK_RE = /^pg:([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}):([0-9]{1,2})$/;
const EXPIRED_PAGE = 'Страница уже недоступна. Открой карточку или раздел заново.';
const SCOPE_KEYS = ['telegramUserId', 'chatId', 'messageId', 'userId', 'conversationId'];

function splitCallbackText(text) {
  const chunks = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 3600, text.length);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf(' ', end - 1));
      if (boundary > offset + 1800) end = boundary + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

class TelegramCallbackPages {
  constructor({ now = Date.now, ttlMs = 10 * 60_000, maxEntries = 200 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  remove(id) {
    clearTimeout(this.entries.get(id)?.timer);
    this.entries.delete(id);
  }

  lookup(input) {
    const match = PAGE_CALLBACK_RE.exec(input.data);
    if (!match) return null;
    const entry = this.entries.get(match[1]);
    if (entry && entry.expiresAt <= this.now()) this.remove(match[1]);
    if (!entry || entry.expiresAt <= this.now() || Number(match[2]) >= entry.chunks.length
      || !SCOPE_KEYS.every((key) => entry.scope[key] === input[key])) return null;
    return { entry, index: Number(match[2]) };
  }

  page(entry, index) {
    const navigation = [];
    if (index > 0) navigation.push({ text: '← Текст', data: `pg:${entry.id}:${index - 1}` });
    if (index + 1 < entry.chunks.length) navigation.push({ text: 'Текст →', data: `pg:${entry.id}:${index + 1}` });
    // This only selects visible return controls; their domain handlers still authorize every click.
    const returnButtons = entry.buttons.map((row) => row.filter((button) => /назад|отмена|^←|^В поиск работы$/iu.test(button.text))).filter((row) => row.length);
    return {
      status: 'answered', plainText: true, disableLinkPreview: true,
      answer: `${entry.chunks[index]}\n\nСтраница ${index + 1}/${entry.chunks.length}`,
      // Changing actions remain on the last page, after the complete preview.
      buttons: [...(index === entry.chunks.length - 1 ? entry.buttons : returnButtons), navigation],
    };
  }

  prepare(result, input) {
    if (result?.status !== 'answered' || !input.messageId || !input.textMessage
      || result.media || result.artifact || result.replyKeyboard || result.jobSearchEntry) return result;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= this.now() || SCOPE_KEYS.every((key) => entry.scope[key] === input[key])) this.remove(id);
    }
    const answer = String(result.answer || '');
    if (answer.length <= 4000) return result;
    // Plain text keeps arbitrary user letters and split HTML tags readable.
    const chunks = splitCallbackText(answer);
    if (chunks.length > 100) throw new Error('Telegram callback text is too long');
    while (this.entries.size >= this.maxEntries) this.remove(this.entries.keys().next().value);
    const id = randomUUID();
    const entry = { id, chunks, buttons: structuredClone(result.buttons || []),
      sourceData: input.data, scope: Object.fromEntries(SCOPE_KEYS.map((key) => [key, input[key]])),
      expiresAt: this.now() + this.ttlMs };
    entry.timer = setTimeout(() => this.remove(id), this.ttlMs);
    entry.timer.unref();
    this.entries.set(id, entry);
    return this.page(entry, 0);
  }
}

module.exports = { PAGE_CALLBACK_RE, EXPIRED_PAGE, TelegramCallbackPages };
