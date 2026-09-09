const { randomUUID } = require('node:crypto');

function words(value) {
  return new Set((String(value || '').toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]{3,40}/gu) || []).slice(0, 40));
}

function similarity(left, right) {
  const a = words(left); const b = words(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.max(a.size, b.size);
}

class ObjectReconciler {
  constructor(options = {}) {
    this.createId = options.createId || (() => `object-${randomUUID()}`);
    this.maxAgeMs = Number(options.maxAgeMs || 5 * 60 * 1000);
    this.matchThreshold = Number(options.matchThreshold || 0.55);
  }

  reconcile({ previous = [], observed = [], at = Date.now() }) {
    const used = new Set();
    return observed.slice(0, 64).map((candidate) => {
      const ranked = previous.filter((item) => !used.has(item.objectId)
        && item.type === candidate.type && at - Number(item.lastSeenAt || 0) <= this.maxAgeMs)
        .map((item) => {
          let score = 0;
          if (candidate.providerId && item.providerId === candidate.providerId) score += 0.45;
          score += similarity(candidate.description, item.description) * 0.35;
          score += similarity(candidate.location, item.location) * 0.2;
          return { item, score };
        }).sort((a, b) => b.score - a.score);
      const ambiguous = ranked.length > 1 && ranked[0].score - ranked[1].score < 0.1;
      const match = !ambiguous && ranked[0]?.score >= this.matchThreshold ? ranked[0].item : null;
      const objectId = match?.objectId || this.createId();
      used.add(objectId);
      return {
        objectId, providerId: candidate.providerId || '', type: candidate.type,
        description: candidate.description || '', location: candidate.location || '',
        state: candidate.state || '', confidence: candidate.confidence ?? null,
        firstSeenAt: match?.firstSeenAt || at, lastSeenAt: at,
        identityConfidence: match ? ranked[0].score : 0,
      };
    });
  }
}

module.exports = { ObjectReconciler, similarity, words };
