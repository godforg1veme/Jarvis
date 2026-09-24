const { LIFE_MODE_POLICIES, getLifeModePolicy } = require('../modes/lifeModePolicy');

const MODE_GUIDANCE = Object.freeze(Object.fromEntries(Object.entries(LIFE_MODE_POLICIES).map(([mode, policy]) => [
  mode,
  Object.freeze({
    responseLength: policy.responseLength,
    initiative: policy.initiative,
    interruptionPolicy: policy.interruptionPolicy,
  }),
])));

function preferenceMap(rows) {
  const result = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.preference_key || row?.key || '');
    if (!key || result.has(key)) continue;
    result.set(key, row.value);
  }
  return result;
}

function buildCommunicationGuidance({ mode = null, preferences = [], recentEventTypes = [] } = {}) {
  const modeName = MODE_GUIDANCE[mode?.mode] ? mode.mode : 'work';
  const base = getLifeModePolicy(modeName);
  const values = preferenceMap(preferences);
  const explicitLength = values.get('response.style');
  const explicitInitiative = values.get('initiative.level');
  const emotionalAdaptation = values.get('contextual_adaptation.enabled') !== false;
  const failed = (Array.isArray(recentEventTypes) ? recentEventTypes : [])
    .some((type) => ['workflow.failed', 'workflow.outcome_unknown', 'recovery.failed', 'recovery.outcome_unknown'].includes(type));
  return Object.freeze({
    responseLength: ['concise', 'balanced', 'detailed'].includes(explicitLength) ? explicitLength : base.responseLength,
    initiative: ['minimal', 'normal', 'high'].includes(explicitInitiative) ? explicitInitiative : base.initiative,
    interruptionPolicy: base.interruptionPolicy,
    tone: emotionalAdaptation && failed ? 'calm' : 'neutral',
    emotionalAdaptation,
    uncertaintyLanguage: true,
  });
}

module.exports = { MODE_GUIDANCE, buildCommunicationGuidance };
