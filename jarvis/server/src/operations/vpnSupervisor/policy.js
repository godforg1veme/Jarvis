const { CATALOG_VERSION } = require('./contracts');
const { playbookById } = require('./playbookCatalog');

function evaluateProposal({ context, proposal }) {
  if (proposal.decision !== 'propose') return Object.freeze({ allowed: false, code: `DECISION_${proposal.decision.toUpperCase()}` });
  const playbook = playbookById(proposal.playbookId);
  if (!playbook || !playbook.enabled) return Object.freeze({ allowed: false, code: 'PLAYBOOK_DISABLED' });
  if (proposal.confidence !== 'high') return Object.freeze({ allowed: false, code: 'CONFIDENCE_TOO_LOW' });
  if (proposal.requiredChecks.length > 0) return Object.freeze({ allowed: false, code: 'CHECKS_PENDING' });
  if (context.synthetic === true) {
    if (context.incident.code !== 'SUPERVISOR_ACCEPTANCE_TEST'
      || proposal.playbookId !== 'supervisor_acceptance_noop'
      || proposal.reasonCode !== 'TEST_ACCEPTANCE') {
      return Object.freeze({ allowed: false, code: 'ACCEPTANCE_MISMATCH' });
    }
    if (!context.node.capabilities.includes(proposal.playbookId)) return Object.freeze({ allowed: false, code: 'CAPABILITY_MISSING' });
    return Object.freeze({ allowed: true, code: 'ACCEPTANCE_NOOP_ALLOWED', catalogVersion: CATALOG_VERSION, playbook });
  }
  if (!context.node.capabilities.includes(proposal.playbookId)) return Object.freeze({ allowed: false, code: 'CAPABILITY_MISSING' });

  const facts = new Map(context.facts.map((fact) => [fact.name, fact.status]));
  const hostReady = facts.get('host') === 'healthy'
    && facts.get('network.dns') === 'healthy'
    && facts.get('network.outbound') === 'healthy'
    && ['healthy', 'unknown'].includes(facts.get('xray.protocol-probe'))
    && ['healthy', 'unknown'].includes(facts.get('hysteria2.protocol-probe'));
  const healthy = (stack) => facts.get(`${stack}.service`) === 'healthy'
    && facts.get(`${stack}.config`) === 'healthy'
    && facts.get(`${stack}.listener`) === 'healthy';
  const restartEligible = hostReady && proposal.reasonCode === 'SERVICE_FAILED'
    && ((proposal.playbookId === 'restart_xray'
      && context.incident.code === 'XRAY_SERVICE_FAILURE'
      && ['degraded', 'unavailable'].includes(facts.get('xray.service'))
      && facts.get('xray.config') === 'healthy'
      && healthy('hysteria2')
      && facts.get('hysteria2.auth') === 'healthy'
      && facts.get('hysteria2.auth-endpoint') === 'healthy'
      && ['healthy', 'unknown'].includes(facts.get('hysteria2.auth-credential-probe')))
      || (proposal.playbookId === 'restart_hysteria2'
        && context.incident.code === 'HYSTERIA2_SERVICE_FAILURE'
        && ['degraded', 'unavailable'].includes(facts.get('hysteria2.service'))
        && facts.get('hysteria2.config') === 'healthy'
        && facts.get('hysteria2.auth') === 'healthy'
        && facts.get('hysteria2.auth-endpoint') === 'healthy'
        && ['healthy', 'unknown'].includes(facts.get('hysteria2.auth-credential-probe'))
        && healthy('xray')));
  if (!restartEligible) return Object.freeze({ allowed: false, code: 'REPAIR_PRECONDITION_FAILED' });
  return Object.freeze({ allowed: true, code: 'OWNER_APPROVAL_REQUIRED', catalogVersion: CATALOG_VERSION, playbook });
}

module.exports = { evaluateProposal };
