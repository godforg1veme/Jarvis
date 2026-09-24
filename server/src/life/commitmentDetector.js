const { applyCommitmentSuggestion } = require('./commitments/commitmentEnrichment');
const { CREATE_CUE, cleanTitle, parseCommitmentIntent } = require('./commitments/commitmentIntentParser');
const { parseRecurrence } = require('./commitments/recurrenceParser');
const { parseTemporal } = require('./commitments/temporalParser');

const COMMITMENT_CUE = CREATE_CUE;

class CommitmentDetector {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
    this.timezone = options.timezone || 'Europe/Moscow';
    this.locale = options.locale || 'ru-RU';
    this.classify = typeof options.classify === 'function' ? options.classify : null;
  }

  async detect(event) {
    if (!['message.received', 'voice.transcribed'].includes(event.event_type)) return null;
    const intent = parseCommitmentIntent(event.summary, this.locale);
    if (!intent) return null;
    const temporal = parseTemporal(event.summary, {
      now: event.occurred_at ? new Date(event.occurred_at) : this.now(),
      timezone: this.timezone, locale: this.locale,
    });
    const anchorDate = temporal.dueAt || (event.occurred_at ? new Date(event.occurred_at) : this.now());
    const deterministic = {
      action: intent.action,
      kind: /(?:задач\p{L}*|(?<![\p{L}\p{N}_])tasks?(?![\p{L}\p{N}_]))/iu.test(event.summary || '') ? 'task' : 'commitment',
      title: cleanTitle(intent.title),
      dueAt: temporal.dueAt,
      dueWindowEndAt: temporal.dueWindowEndAt,
      temporalPrecision: temporal.precision,
      timezone: temporal.timezone,
      recurrence: parseRecurrence(event.summary, this.locale, { anchorDate, timezone: this.timezone }),
      confidence: Math.min(intent.confidence, temporal.dueAt ? temporal.confidence : intent.confidence - 0.18),
      evidence: { sourceEventId: event.id || null, parser: 'deterministic_v2' },
      deduplicationKey: event.id ? `commitment:${event.id}` : null,
    };
    return applyCommitmentSuggestion(this.classify, { text: String(event.summary || '') }, deterministic);
  }
}

function inferredDueAt(text, now = new Date(), timezone = 'Europe/Moscow') {
  return parseTemporal(text, { now, timezone }).dueAt;
}

module.exports = { COMMITMENT_CUE, CommitmentDetector, cleanCommitmentTitle: cleanTitle, inferredDueAt };
