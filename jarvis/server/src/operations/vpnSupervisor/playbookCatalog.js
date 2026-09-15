const { CATALOG_VERSION } = require('./contracts');

const PLAYBOOK_CATALOG = Object.freeze([
  Object.freeze({ id: 'restart_xray', affectedStack: 'xray', enabled: false, mutation: true,
    incidentCodes: Object.freeze(['XRAY_SERVICE_FAILURE']), preconditions: Object.freeze(['config_valid', 'hysteria2_healthy']),
    postChecks: Object.freeze(['xray_config', 'xray_service', 'xray_listeners', 'hysteria2_healthy']), rollback: 'none' }),
  Object.freeze({ id: 'restart_hysteria2', affectedStack: 'hysteria2', enabled: false, mutation: true,
    incidentCodes: Object.freeze(['HYSTERIA2_SERVICE_FAILURE']), preconditions: Object.freeze(['config_valid', 'auth_healthy', 'xray_healthy']),
    postChecks: Object.freeze(['hysteria2_config', 'hysteria2_service', 'hysteria2_listener', 'auth_healthy', 'xray_healthy']), rollback: 'none' }),
  Object.freeze({ id: 'restore_xray_known_good', affectedStack: 'xray', enabled: false, mutation: true,
    incidentCodes: Object.freeze(['XRAY_CONFIG_FAILURE']), preconditions: Object.freeze(['known_good_available', 'rollback_available', 'hysteria2_healthy']),
    postChecks: Object.freeze(['xray_config', 'xray_service', 'xray_listeners', 'hysteria2_healthy']), rollback: 'restore_pre_action_copy' }),
  Object.freeze({ id: 'restore_hysteria2_known_good', affectedStack: 'hysteria2', enabled: false, mutation: true,
    incidentCodes: Object.freeze(['HYSTERIA2_CONFIG_FAILURE']), preconditions: Object.freeze(['known_good_available', 'rollback_available', 'xray_healthy']),
    postChecks: Object.freeze(['hysteria2_config', 'hysteria2_service', 'hysteria2_listener', 'auth_healthy', 'xray_healthy']), rollback: 'restore_pre_action_copy' }),
  Object.freeze({ id: 'supervisor_acceptance_noop', affectedStack: 'none', enabled: true, mutation: false,
    incidentCodes: Object.freeze(['SUPERVISOR_ACCEPTANCE_TEST']), preconditions: Object.freeze(['synthetic_incident', 'owner_confirmation']),
    postChecks: Object.freeze(['no_host_agent_call', 'vpn_state_unchanged']), rollback: 'none' }),
]);

function publicCatalog() {
  return { version: CATALOG_VERSION, playbooks: PLAYBOOK_CATALOG.map((item) => ({ ...item })) };
}

function playbookById(id) {
  return PLAYBOOK_CATALOG.find((item) => item.id === id) || null;
}

module.exports = { PLAYBOOK_CATALOG, playbookById, publicCatalog };
