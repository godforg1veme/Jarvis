const { LIFE_MODES } = require('./lifeModeSchemas');

const BASE_INVARIANTS = Object.freeze({
  changesAuthority: false,
  changesPrivacy: false,
  changesFamilyAccess: false,
  bypassesConfirmation: false,
});

const POLICY_INPUTS = {
  work: {
    responseLength: 'balanced', initiative: 'normal', interruptionPolicy: 'normal',
    notificationPolicy: 'normal', proposalVisibility: 'all', missionEmphasis: 'work',
    categoryWeights: { project: 1.15, commitment: 1.15, document: 1.05 },
    allowedSourceCategories: ['calendar', 'tasks', 'email', 'documents', 'devices', 'travel', 'family', 'people', 'smart_home'],
  },
  focus: {
    responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'focus',
    notificationPolicy: 'defer_non_urgent', proposalVisibility: 'urgent_and_current', missionEmphasis: 'current_project',
    categoryWeights: { project: 1.3, commitment: 1.2, continuation: 1.3, event: 0.7 },
    allowedSourceCategories: ['calendar', 'tasks', 'documents', 'devices'],
  },
  home: {
    responseLength: 'balanced', initiative: 'normal', interruptionPolicy: 'normal',
    notificationPolicy: 'normal', proposalVisibility: 'all', missionEmphasis: 'home',
    categoryWeights: { event: 1.05, device: 1.1 },
    allowedSourceCategories: ['calendar', 'tasks', 'deliveries', 'subscriptions', 'family', 'smart_home', 'devices'],
  },
  family: {
    responseLength: 'balanced', initiative: 'normal', interruptionPolicy: 'normal',
    notificationPolicy: 'normal', proposalVisibility: 'all', missionEmphasis: 'family',
    categoryWeights: { person: 1.3, commitment: 1.1, event: 1.1 },
    allowedSourceCategories: ['calendar', 'tasks', 'family', 'people', 'travel', 'deliveries'],
  },
  meeting: {
    responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'focus',
    notificationPolicy: 'defer_non_urgent', proposalVisibility: 'urgent_and_current', missionEmphasis: 'meeting',
    categoryWeights: { person: 1.2, document: 1.2, commitment: 1.15, event: 0.75 },
    allowedSourceCategories: ['calendar', 'tasks', 'documents', 'people'],
  },
  travel: {
    responseLength: 'concise', initiative: 'normal', interruptionPolicy: 'normal',
    notificationPolicy: 'important_only', proposalVisibility: 'important', missionEmphasis: 'travel',
    categoryWeights: { event: 1.1, commitment: 1.1, device: 0.8 },
    allowedSourceCategories: ['calendar', 'travel', 'deliveries', 'family', 'devices'],
  },
  rest: {
    responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'defer_non_urgent',
    notificationPolicy: 'defer_non_urgent', proposalVisibility: 'urgent_only', missionEmphasis: 'recovery',
    categoryWeights: { project: 0.7, event: 0.75, commitment: 0.85 },
    allowedSourceCategories: ['calendar', 'family', 'smart_home'],
  },
  sleep: {
    responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'quiet',
    notificationPolicy: 'critical_only', proposalVisibility: 'critical_only', missionEmphasis: 'none',
    categoryWeights: { project: 0.5, event: 0.5, commitment: 0.65 },
    allowedSourceCategories: ['family', 'smart_home'],
  },
  emergency: {
    responseLength: 'concise', initiative: 'high', interruptionPolicy: 'critical_only',
    notificationPolicy: 'critical_only', proposalVisibility: 'critical_only', missionEmphasis: 'critical',
    categoryWeights: { project: 0.6, event: 1.3, device: 1.2, commitment: 1.15 },
    allowedSourceCategories: ['calendar', 'travel', 'family', 'smart_home', 'devices'],
  },
};

const LIFE_MODE_POLICIES = Object.freeze(Object.fromEntries(LIFE_MODES.map((mode) => [
  mode,
  Object.freeze({
    mode,
    ...POLICY_INPUTS[mode],
    categoryWeights: Object.freeze({ ...POLICY_INPUTS[mode].categoryWeights }),
    allowedSourceCategories: Object.freeze([...POLICY_INPUTS[mode].allowedSourceCategories]),
    invariants: BASE_INVARIANTS,
  }),
])));

function getLifeModePolicy(mode) {
  return LIFE_MODE_POLICIES[mode] || LIFE_MODE_POLICIES.work;
}

module.exports = { BASE_INVARIANTS, LIFE_MODE_POLICIES, getLifeModePolicy };
