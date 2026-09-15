const { CATALOG_VERSION } = require('./contracts');
const { playbookById } = require('./playbookCatalog');

function evaluateProposal({ context, proposal }) {
  if (proposal.decision !== 'propose') return Object.freeze({ allowed: false, code: `DECISION_${proposal.decision.toUpperCase()}` });
  const playbook = playbookById(proposal.playbookId);
  if (!playbook || !playbook.enabled) return Object.freeze({ allowed: false, code: 'PLAYBOOK_DISABLED' });
  if (proposal.confidence !== 'high') return Object.freeze({ allowed: false, code: 'CONFIDENCE_TOO_LOW' });
  if (proposal.requiredChecks.length > 0) return Object.freeze({ allowed: false, code: 'CHECKS_PENDING' });
  if (context.synthetic !== true || context.incident.code !== 'SUPERVISOR_ACCEPTANCE_TEST') return Object.freeze({ allowed: false, code: 'REAL_EXECUTION_DISABLED' });
  if (proposal.playbookId !== 'supervisor_acceptance_noop' || proposal.reasonCode !== 'TEST_ACCEPTANCE') return Object.freeze({ allowed: false, code: 'ACCEPTANCE_MISMATCH' });
  if (!context.node.capabilities.includes(proposal.playbookId)) return Object.freeze({ allowed: false, code: 'CAPABILITY_MISSING' });
  return Object.freeze({ allowed: true, code: 'ACCEPTANCE_NOOP_ALLOWED', catalogVersion: CATALOG_VERSION, playbook });
}

module.exports = { evaluateProposal };
