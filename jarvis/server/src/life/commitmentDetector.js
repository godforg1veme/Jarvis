const COMMITMENT_CUE = /(?:^|[^\p{L}\p{N}])(?:я\s+(?:обещаю|сделаю|закончу|продолжу|позвоню|отправлю|проверю)|мне\s+(?:надо|нужно)|напомни(?:те)?|i\s+will|i'll|remind\s+me|need\s+to)(?=$|[^\p{L}\p{N}])/iu;

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function inferredDueAt(text, now = new Date()) {
  const source = String(text || '');
  const day = startOfLocalDay(now);
  if (/(?:послезавтра|day\s+after\s+tomorrow)/iu.test(source)) day.setDate(day.getDate() + 2);
  else if (/(?:завтра|tomorrow)/iu.test(source)) day.setDate(day.getDate() + 1);
  else if (/(?:сегодня|today)/iu.test(source)) day.setDate(day.getDate());
  else return null;

  if (/(?:утром|morning)/iu.test(source)) day.setHours(9);
  else if (/(?:вечером|evening)/iu.test(source)) day.setHours(19);
  else if (/(?:дн[её]м|afternoon)/iu.test(source)) day.setHours(14);
  else day.setHours(12);
  return day;
}

function cleanCommitmentTitle(text) {
  return String(text || '')
    .replace(/^\s*(?:напомни(?:те)?\s+(?:мне\s+)?(?:что\s+)?)/iu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

class CommitmentDetector {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
    this.classify = typeof options.classify === 'function' ? options.classify : null;
  }

  async detect(event) {
    if (!['message.received', 'voice.transcribed'].includes(event.event_type)) return null;
    const text = String(event.summary || '').trim();
    if (!COMMITMENT_CUE.test(text)) return null;
    const deterministic = {
      title: cleanCommitmentTitle(text),
      dueAt: inferredDueAt(text, this.now()),
      confidence: inferredDueAt(text, this.now()) ? 0.9 : 0.72,
    };
    if (!this.classify) return deterministic;
    try {
      const classified = await this.classify({ text, deterministic });
      if (!classified || classified.isCommitment !== true) return deterministic;
      const title = cleanCommitmentTitle(classified.title || deterministic.title);
      const dueAt = classified.dueAt ? new Date(classified.dueAt) : deterministic.dueAt;
      if (!title || (dueAt && Number.isNaN(dueAt.getTime()))) return deterministic;
      return { title, dueAt, confidence: Math.min(Math.max(Number(classified.confidence) || deterministic.confidence, 0), 0.95) };
    } catch (_) {
      return deterministic;
    }
  }
}

module.exports = { COMMITMENT_CUE, CommitmentDetector, cleanCommitmentTitle, inferredDueAt };
