const { POLICY, policyForAction } = require('./toolGateway');

const INTERNAL_ACTION_POLICIES = {
  ask_user: POLICY.OBSERVE,
  report: POLICY.OBSERVE,
  'agent.analyze': POLICY.OBSERVE,
  'agent.llm_plan': POLICY.OBSERVE,
};

function normalizeId(value, index) {
  const raw = String(value || '').trim();
  const fallback = `step_${index + 1}`;
  return (raw || fallback)
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || fallback;
}

function normalizeDependsOn(step) {
  const source = step.dependsOn || step.depends_on || [];
  if (!Array.isArray(source)) return [];
  return source.map((item) => String(item || '').trim()).filter(Boolean);
}

function policyForPlanAction(action, stepPolicy) {
  const gatewayPolicy = policyForAction(action);
  if (gatewayPolicy) return gatewayPolicy;
  if (INTERNAL_ACTION_POLICIES[action]) return INTERNAL_ACTION_POLICIES[action];
  if (Object.values(POLICY).includes(stepPolicy)) return stepPolicy;
  return '';
}

function normalizePlanDraft(plan, options = {}) {
  const maxSteps = Math.max(1, Number(options.maxSteps || 10));
  const sourcePlan = Array.isArray(plan) ? plan : [];
  const dependencyErrors = [];
  const warnings = [];

  if (sourcePlan.length > maxSteps) {
    warnings.push(`plan has ${sourcePlan.length} steps; only first ${maxSteps} are active`);
  }

  const usedIds = new Set();
  const normalized = sourcePlan.slice(0, maxSteps).map((rawStep, index) => {
    const step = rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep) ? rawStep : {};
    const action = String(step.action || '').trim();
    const stepPolicy = String(step.policy || '').trim();
    let id = normalizeId(step.id || action, index);
    if (usedIds.has(id)) {
      const originalId = id;
      id = `${id}_${index + 1}`;
      dependencyErrors.push({
        stepId: id,
        message: `duplicate step id "${originalId}" was renamed to "${id}"`,
      });
    }
    usedIds.add(id);

    const policy = policyForPlanAction(action, stepPolicy);
    const enabled = step.enabled !== false && !!action && !!policy;
    const args = step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? step.args : {};

    if (!action) {
      dependencyErrors.push({ stepId: id, message: 'step action is required' });
    } else if (!policy) {
      dependencyErrors.push({ stepId: id, message: `unknown step action: ${action}` });
    }

    return {
      ...step,
      id,
      title: String(step.title || action || id),
      action,
      policy,
      args,
      dependsOn: normalizeDependsOn(step),
      depends_on: normalizeDependsOn(step),
      enabled,
      status: step.status || 'pending',
      requiresConfirmation: policy === POLICY.CONFIRM,
      requiresStrongConfirmation: policy === POLICY.STRONG,
    };
  });

  const byId = new Map(normalized.map((step) => [step.id, step]));
  for (const step of normalized) {
    if (!step.enabled) continue;
    for (const dependencyId of step.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        step.status = 'blocked';
        dependencyErrors.push({
          stepId: step.id,
          dependencyId,
          message: `dependency "${dependencyId}" does not exist`,
        });
        continue;
      }

      if (dependency.enabled === false) {
        step.status = 'blocked';
        dependencyErrors.push({
          stepId: step.id,
          dependencyId,
          message: `dependency "${dependencyId}" is disabled`,
        });
      }
    }
  }

  return {
    plan: normalized,
    dependencyErrors,
    warnings,
    limits: { maxSteps },
  };
}

function normalizePlanEvent(event, options = {}) {
  if (!event || event.type !== 'plan_draft') return event;
  const payload = event.payload || {};
  const state = payload.state && typeof payload.state === 'object' ? payload.state : {};
  const sourcePlan = Array.isArray(payload.plan) ? payload.plan : state.plan;
  const normalized = normalizePlanDraft(sourcePlan, options);

  return {
    ...event,
    payload: {
      ...payload,
      plan: normalized.plan,
      validation: {
        dependencyErrors: normalized.dependencyErrors,
        warnings: normalized.warnings,
        limits: normalized.limits,
      },
      state: {
        ...state,
        plan: normalized.plan,
        dependency_errors: normalized.dependencyErrors,
      },
    },
  };
}

module.exports = {
  INTERNAL_ACTION_POLICIES,
  normalizePlanDraft,
  normalizePlanEvent,
  policyForPlanAction,
};
