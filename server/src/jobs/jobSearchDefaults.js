function defaultJobSettings() {
  return { queries: [], exclusions: [], targetRub: null,
    officeCity: '', remote: null, historyDays: 14, intervalMs: 1800000,
    budgetUsd: 3, model: '', paused: false, activated: false };
}

module.exports = { defaultJobSettings };
