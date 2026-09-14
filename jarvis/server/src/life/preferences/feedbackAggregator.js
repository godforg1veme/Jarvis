const SUPPRESSION_THRESHOLD = 3;
const NEGATIVE_KINDS = new Set(['dismissed', 'not_useful', 'suppress_similar']);

class FeedbackAggregator {
  constructor(options = {}) {
    this.repository = options.repository;
    this.threshold = Math.min(Math.max(Number(options.threshold) || SUPPRESSION_THRESHOLD, 2), 20);
  }

  async aggregate({ userId }) {
    const rows = await this.repository.listProposalFeedback({ userId, limit: 5000 });
    const seen = new Set();
    const counts = new Map();
    for (const row of rows) {
      const replayKey = row?.target_id || row?.id;
      if (!replayKey || seen.has(replayKey) || !NEGATIVE_KINDS.has(row.kind)) continue;
      seen.add(replayKey);
      const rule = String(row.source_rule || '').trim();
      if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(rule)) continue;
      counts.set(rule, (counts.get(rule) || 0) + 1);
    }
    const suppressed = [...counts.entries()].filter(([, count]) => count >= this.threshold)
      .sort(([left], [right]) => left.localeCompare(right)).map(([rule]) => rule).slice(0, 32);
    const evidenceCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const current = await this.repository.get({ userId, key: 'proposal.suppressed_rules' });
    if (current?.source === 'explicit') return { updated: false, reason: 'explicit_preference', preference: current };
    if (!current && evidenceCount === 0) return { updated: false, reason: 'insufficient_evidence', preference: null };
    const explanation = suppressed.length
      ? `Снижена частота правил после повторной отрицательной обратной связи (${suppressed.length})`
      : 'Недостаточно повторной обратной связи для подавления правил';
    const row = await this.repository.setDerived({
      userId, key: 'proposal.suppressed_rules', value: suppressed, explanation,
      evidenceCount, confidence: Math.min(evidenceCount / (this.threshold * Math.max(suppressed.length, 1)), 1),
      expectedRevision: current?.revision || null,
    });
    return { updated: Boolean(row), reason: row ? 'derived' : 'conflict', preference: row || current || null };
  }
}

module.exports = { FeedbackAggregator, NEGATIVE_KINDS, SUPPRESSION_THRESHOLD };
