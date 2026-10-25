const { jobError } = require('./jobSchemas');

function recordReconciliationGap(progress, window, code, queryIndex) {
  if (!Number.isInteger(queryIndex) || queryIndex < 0 || queryIndex > 99) throw jobError('JOB_HH_INVALID_RESPONSE');
  progress.gaps ||= [];
  const existing = progress.gaps.find(gap => gap.queryIndex === queryIndex);
  if (existing) {
    if (window.from < existing.from) existing.from = window.from;
    if (window.to > existing.to) existing.to = window.to;
    if (!existing.codes.includes(code)) existing.codes.push(code);
  } else {
    // The settings revision already binds query order; avoid duplicating up to
    // 100 long UTF-8 queries in both pending windows and gap summaries.
    progress.gaps.push({ queryIndex, from: window.from, to: window.to, codes: [code] });
  }
}

module.exports = { recordReconciliationGap };
