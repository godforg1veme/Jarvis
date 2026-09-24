function iso(value) { return value ? new Date(value).toISOString() : null; }

function publicRecoveryPlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id, projectId: plan.project_id, summary: plan.summary,
    creationReason: plan.creation_reason, sourceContextRevision: Number(plan.source_context_revision),
    status: plan.status, expiresAt: iso(plan.expires_at), revision: plan.revision,
    steps: (plan.steps || []).slice(0, 32).map((step) => ({
      id: step.id, position: step.position, type: step.step_type, label: step.label,
      risk: step.risk_class, action: step.action_name || null,
      dependencies: Array.isArray(step.depends_on_positions) ? step.depends_on_positions : [],
      status: step.status, result: step.result_summary || '', revision: step.revision,
    })),
  };
}

module.exports = { publicRecoveryPlan };
