const DEFAULT_RRF_K = 60;

function resultKey(result) {
  if (result && result.id !== undefined && result.id !== null) return `chunk:${result.id}`;
  return `document:${result && result.document_id}:${result && result.position}`;
}

function reciprocalRankFusion(lists, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 8), 1), 100);
  const k = Math.max(Number(options.k || DEFAULT_RRF_K), 1);
  const merged = new Map();

  for (const list of Array.isArray(lists) ? lists : []) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const key = resultKey(item);
      const existing = merged.get(key) || { ...item, _rrfScore: 0, _ranks: [] };
      if (merged.has(key)) Object.assign(existing, item);
      existing._rrfScore += 1 / (k + index + 1);
      existing._ranks.push(index + 1);
      merged.set(key, existing);
    });
  }

  return [...merged.values()]
    .sort((left, right) => right._rrfScore - left._rrfScore
      || Math.min(...left._ranks) - Math.min(...right._ranks)
      || String(left.document_id).localeCompare(String(right.document_id))
      || Number(left.position || 0) - Number(right.position || 0))
    .slice(0, limit)
    .map(({ _rrfScore, _ranks, ...result }) => ({ ...result, hybrid_score: _rrfScore }));
}

module.exports = { DEFAULT_RRF_K, reciprocalRankFusion, resultKey };
