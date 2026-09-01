const MAX_MEMORY_LENGTH = 1000;

const SENSITIVE_MEMORY_PATTERNS = [
  /(?:password|passphrase|token|api[ _-]?key|secret|парол[ья]?|токен|секрет|ключ)/i,
  /(?:cvv|cvc|iban|card number|номер карты|банковск\S* карт\S*)/i,
  /\b\d[\d -]{11,22}\d\b/,
];

function normalizeMemoryContent(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_MEMORY_LENGTH);
}

function containsSensitiveMemoryData(value) {
  return SENSITIVE_MEMORY_PATTERNS.some((pattern) => pattern.test(String(value || '')));
}

function parseMemoryCommand(text) {
  const value = normalizeMemoryContent(text);
  if (/^(?:что\s+ты\s+(?:обо\s+мне\s+)?помнишь|что\s+ты\s+помнишь\s+обо\s+мне|\/memory)$/i.test(value)) {
    return { type: 'list' };
  }
  const remember = value.match(/^запомни(?:,?\s+что)?\s+(.+)$/i);
  if (remember) return { type: 'remember', content: normalizeMemoryContent(remember[1]) };
  const forget = value.match(/^забудь\s+(.+)$/i);
  if (forget) return { type: 'forget', query: normalizeMemoryContent(forget[1]) };
  const correct = value.match(/^исправь\s+(.+?)\s*(?:->|→)\s*(.+)$/i);
  if (correct) {
    return {
      type: 'correct',
      query: normalizeMemoryContent(correct[1]),
      content: normalizeMemoryContent(correct[2]),
    };
  }
  if (/^исправь\b/i.test(value)) return { type: 'correct-format' };
  return null;
}

function inferUsefulFact(text) {
  const value = normalizeMemoryContent(text);
  if (!value || containsSensitiveMemoryData(value)) return null;
  if (/^(?:меня\s+зовут|я\s+(?:живу|работаю|учусь|люблю|предпочитаю|не\s+люблю)|мне\s+\d{1,3}\s+лет)(?:\s|$)/i.test(value)) {
    return { kind: /люблю|предпочитаю|не\s+люблю/i.test(value) ? 'preference' : 'profile', content: value };
  }
  return null;
}

class MemoryService {
  constructor(options) {
    this.repository = options.repository;
  }

  async memoriesForPrompt({ userId }) {
    const memories = await this.repository.listActive({ userId, limit: 30 });
    return memories.map(({ kind, content, updated_at: updatedAt }) => ({ kind, content, updatedAt }));
  }

  async handleUserText({ userId, text, sourceConversationId = null }) {
    const command = parseMemoryCommand(text);
    if (command) return this._handleCommand({ userId, command, sourceConversationId });

    const candidate = inferUsefulFact(text);
    if (!candidate) return { handled: false };
    const existing = await this.repository.listActive({ userId, limit: 100 });
    if (existing.some((memory) => normalizeMemoryContent(memory.content).toLocaleLowerCase('ru') === candidate.content.toLocaleLowerCase('ru'))) {
      return { handled: false };
    }
    await this.repository.create({
      userId,
      kind: candidate.kind,
      content: candidate.content,
      sourceConversationId,
      changeReason: 'automatic_high_confidence_fact',
    });
    return { handled: false, rememberedAutomatically: true };
  }

  async _handleCommand({ userId, command, sourceConversationId }) {
    if (command.type === 'list') {
      const memories = await this.repository.listActive({ userId, limit: 30 });
      if (memories.length === 0) return { handled: true, answer: 'Пока ничего не сохранено. Напиши «запомни …», когда захочешь добавить факт.' };
      return {
        handled: true,
        answer: `Я помню:\n${memories.map((memory, index) => `${index + 1}. ${memory.content}`).join('\n')}`,
      };
    }
    if (command.type === 'correct-format') {
      return { handled: true, answer: 'Укажи старый и новый факт так: «исправь старое → новое».' };
    }
    if ((command.type === 'remember' || command.type === 'correct') && containsSensitiveMemoryData(command.content)) {
      return { handled: true, answer: 'Я не сохраняю пароли, токены, ключи и платёжные данные.' };
    }
    if (command.type === 'remember') {
      if (!command.content) return { handled: true, answer: 'Напиши, что именно запомнить.' };
      await this.repository.create({
        userId,
        kind: 'fact',
        content: command.content,
        sourceConversationId,
        changeReason: 'user_remember',
      });
      return { handled: true, answer: 'Запомнил.' };
    }
    if (command.type === 'forget') {
      if (!command.query) return { handled: true, answer: 'Напиши, какой факт забыть.' };
      const removed = await this.repository.deactivateMatching({ userId, query: command.query, changeReason: 'user_forget' });
      return { handled: true, answer: removed.length ? 'Забыл.' : 'Подходящий сохранённый факт не найден.' };
    }
    if (command.type === 'correct') {
      if (!command.query || !command.content) return { handled: true, answer: 'Укажи старый и новый факт так: «исправь старое → новое».' };
      await this.repository.deactivateMatching({ userId, query: command.query, changeReason: 'user_correction' });
      await this.repository.create({
        userId,
        kind: 'fact',
        content: command.content,
        sourceConversationId,
        changeReason: 'user_correction',
      });
      return { handled: true, answer: 'Исправил и буду считать новый факт актуальным.' };
    }
    return { handled: false };
  }
}

module.exports = {
  MAX_MEMORY_LENGTH,
  MemoryService,
  SENSITIVE_MEMORY_PATTERNS,
  containsSensitiveMemoryData,
  inferUsefulFact,
  normalizeMemoryContent,
  parseMemoryCommand,
};
