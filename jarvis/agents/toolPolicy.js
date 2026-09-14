const POLICY = Object.freeze({
  OBSERVE: 'observe',
  LOW_RISK: 'low_risk',
  CONFIRM: 'requires_confirmation',
  STRONG: 'requires_strong_confirmation',
});

const USER_ACTION_CATEGORY = Object.freeze({
  SAFE: 'safe',
  CHANGING: 'changing',
});

const ACTION_POLICIES = Object.freeze({
  'file.search': POLICY.OBSERVE,
  'file.list_directory': POLICY.OBSERVE,
  'app.resolve': POLICY.OBSERVE,
  'window.list': POLICY.OBSERVE,
  'vision.capture': POLICY.OBSERVE,

  'file.open': POLICY.LOW_RISK,
  'file.open_folder': POLICY.LOW_RISK,
  'file.reveal': POLICY.LOW_RISK,
  'window.focus': POLICY.LOW_RISK,
  'window.restore': POLICY.LOW_RISK,

  'file.create_folder': POLICY.CONFIRM,
  'file.create_text_file': POLICY.CONFIRM,
  'file.rename': POLICY.CONFIRM,
  'file.move': POLICY.CONFIRM,
  'file.copy': POLICY.CONFIRM,
  'file.delete': POLICY.CONFIRM,
  'app.launch': POLICY.CONFIRM,
  'app.close': POLICY.CONFIRM,
  'window.close': POLICY.CONFIRM,
  'window.move': POLICY.CONFIRM,
  'window.resize': POLICY.CONFIRM,
  'window.layout': POLICY.CONFIRM,
  'workspace.prepare': POLICY.CONFIRM,

  'file.permanent_delete': POLICY.STRONG,
  'file.move_batch': POLICY.STRONG,
  'file.copy_batch': POLICY.STRONG,
  'file.rename_batch': POLICY.STRONG,
  'file.delete_batch': POLICY.STRONG,
});

const OVERWRITE_CAPABLE_ACTIONS = new Set([
  'file.create_folder',
  'file.create_text_file',
  'file.move',
  'file.copy',
]);

function normalizeAction(action) {
  return String(action || '').trim();
}

function policyForAction(action, args = {}) {
  const normalizedAction = normalizeAction(action);
  const basePolicy = ACTION_POLICIES[normalizedAction] || '';
  if (basePolicy && args.overwrite === true && OVERWRITE_CAPABLE_ACTIONS.has(normalizedAction)) {
    return POLICY.STRONG;
  }
  return basePolicy;
}

function categoryForPolicy(policy) {
  if (policy === POLICY.OBSERVE || policy === POLICY.LOW_RISK) {
    return USER_ACTION_CATEGORY.SAFE;
  }
  if (policy === POLICY.CONFIRM || policy === POLICY.STRONG) {
    return USER_ACTION_CATEGORY.CHANGING;
  }
  return '';
}

function categoryForAction(action, args = {}) {
  return categoryForPolicy(policyForAction(action, args));
}

module.exports = {
  POLICY,
  USER_ACTION_CATEGORY,
  ACTION_POLICIES,
  categoryForAction,
  categoryForPolicy,
  normalizeAction,
  policyForAction,
};
