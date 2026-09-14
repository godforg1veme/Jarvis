const MODE_GUIDANCE = Object.freeze({
  work: { responseLength: 'balanced', initiative: 'normal', interruptionPolicy: 'normal' },
  focus: { responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'focus' },
  home: { responseLength: 'balanced', initiative: 'normal', interruptionPolicy: 'normal' },
  family: { responseLength: 'balanced', initiative: 'normal', interruptionPolicy: 'normal' },
  meeting: { responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'focus' },
  travel: { responseLength: 'concise', initiative: 'normal', interruptionPolicy: 'normal' },
  rest: { responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'defer_non_urgent' },
  sleep: { responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'quiet' },
  emergency: { responseLength: 'concise', initiative: 'high', interruptionPolicy: 'critical_only' },
});

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
  const base = MODE_GUIDANCE[modeName];
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
