const { z } = require('zod');

const STATUS_VALUES = ['healthy', 'degraded', 'unavailable', 'unknown'];
const EVIDENCE_PATHS = [
  'host', 'network.dns', 'network.outbound',
  'xray.service', 'xray.config', 'xray.listener', 'xray.protocolProbe',
  'hysteria2.service', 'hysteria2.config', 'hysteria2.listener', 'hysteria2.auth',
  'hysteria2.authEndpoint', 'hysteria2.authCredentialProbe', 'hysteria2.protocolProbe',
];
const NEXT_CHECKS = [
  'host_resources', 'host_dns_probe', 'host_outbound_probe',
  'xray_config_test', 'xray_service_status', 'xray_listener_probe',
  'hysteria2_config_test', 'hysteria2_service_status', 'hysteria2_listener_probe',
  'host_agent_status', 'hysteria_auth_endpoint_probe', 'hysteria_auth_credential_probe',
  'vpn_snapshot_repeat',
];

const INCIDENT_DEFINITIONS = Object.freeze({
  VPN_SNAPSHOT_INVALID: Object.freeze({ failureKind: 'vpn.snapshot_invalid', scope: 'host', severities: ['warning'], confidences: ['low'], likelyCause: 'snapshot_contract', checks: ['vpn_snapshot_repeat'] }),
  HOST_UNAVAILABLE: Object.freeze({ failureKind: 'vpn.host_unavailable', scope: 'host', severities: ['warning', 'critical'], confidences: ['medium', 'high'], likelyCause: 'host_probe', checks: ['host_resources'] }),
  HOST_DNS_FAILURE: Object.freeze({ failureKind: 'vpn.host_dns_failure', scope: 'host', severities: ['warning', 'error'], confidences: ['medium', 'high'], likelyCause: 'host_dns', checks: ['host_dns_probe'] }),
  HOST_OUTBOUND_FAILURE: Object.freeze({ failureKind: 'vpn.host_outbound_failure', scope: 'host', severities: ['warning', 'error'], confidences: ['medium', 'high'], likelyCause: 'host_outbound', checks: ['host_outbound_probe'] }),
  XRAY_CONFIG_FAILURE: Object.freeze({ failureKind: 'vpn.xray.config_failure', scope: 'xray', severities: ['error'], confidences: ['high'], likelyCause: 'xray_config', checks: ['xray_config_test'] }),
  XRAY_SERVICE_FAILURE: Object.freeze({ failureKind: 'vpn.xray.service_failure', scope: 'xray', severities: ['error'], confidences: ['high'], likelyCause: 'xray_service', checks: ['xray_service_status'] }),
  XRAY_LISTENER_FAILURE: Object.freeze({ failureKind: 'vpn.xray.listener_failure', scope: 'xray', severities: ['error'], confidences: ['high'], likelyCause: 'xray_listener', checks: ['xray_listener_probe'] }),
  HYSTERIA2_CONFIG_FAILURE: Object.freeze({ failureKind: 'vpn.hysteria2.config_failure', scope: 'hysteria2', severities: ['error'], confidences: ['high'], likelyCause: 'hysteria2_config', checks: ['hysteria2_config_test'] }),
  HYSTERIA2_SERVICE_FAILURE: Object.freeze({ failureKind: 'vpn.hysteria2.service_failure', scope: 'hysteria2', severities: ['error'], confidences: ['high'], likelyCause: 'hysteria2_service', checks: ['hysteria2_service_status'] }),
  HYSTERIA2_LISTENER_FAILURE: Object.freeze({ failureKind: 'vpn.hysteria2.listener_failure', scope: 'hysteria2', severities: ['error'], confidences: ['high'], likelyCause: 'hysteria2_listener', checks: ['hysteria2_listener_probe'] }),
  HYSTERIA2_AUTH_ENDPOINT_FAILURE: Object.freeze({ failureKind: 'vpn.hysteria2.auth_endpoint_failure', scope: 'hysteria2', severities: ['error'], confidences: ['high'], likelyCause: 'host_agent_auth_dependency', checks: ['host_agent_status', 'hysteria_auth_endpoint_probe'] }),
  HYSTERIA2_AUTH_CREDENTIAL_FAILURE: Object.freeze({ failureKind: 'vpn.hysteria2.auth_credential_failure', scope: 'hysteria2', severities: ['error'], confidences: ['high'], likelyCause: 'hysteria_auth_credential', checks: ['hysteria_auth_credential_probe'] }),
  VPN_MULTI_STACK_FAILURE: Object.freeze({ failureKind: 'vpn.multi_stack_failure', scope: 'multi', severities: ['critical'], confidences: ['high'], likelyCause: 'multi_stack_local_failure', checks: ['xray_service_status', 'hysteria2_service_status'] }),
  UNKNOWN_VPN_FAILURE: Object.freeze({ failureKind: 'vpn.unknown_failure', scope: 'multi', severities: ['warning'], confidences: ['low'], likelyCause: 'insufficient_evidence', checks: ['vpn_snapshot_repeat'] }),
});

const statusSchema = z.enum(STATUS_VALUES);
const rawVpnHealthSchema = z.object({
  host: statusSchema,
  network: z.object({ dns: statusSchema, outbound: statusSchema }).strict(),
  xray: z.object({ service: statusSchema, config: statusSchema, listener: statusSchema, protocolProbe: statusSchema }).strict(),
  hysteria2: z.object({
    service: statusSchema, config: statusSchema, listener: statusSchema, auth: statusSchema,
    authEndpoint: statusSchema, authCredentialProbe: statusSchema, protocolProbe: statusSchema,
  }).strict(),
}).strict();

const evidenceSchema = z.object({ path: z.enum(EVIDENCE_PATHS), status: statusSchema }).strict();
const primarySchema = z.object({
  code: z.enum(Object.keys(INCIDENT_DEFINITIONS)),
  failureKind: z.string().regex(/^vpn\.[a-z0-9_.-]{1,120}$/),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  scope: z.enum(['host', 'xray', 'hysteria2', 'multi']),
  confidence: z.enum(['low', 'medium', 'high']),
  likelyCause: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  evidence: z.array(evidenceSchema).min(1).max(12),
  safeNextChecks: z.array(z.enum(NEXT_CHECKS)).max(4),
}).strict().superRefine((primary, ctx) => {
  const expected = INCIDENT_DEFINITIONS[primary.code];
  const exact = [
    ['failureKind', primary.failureKind, expected.failureKind],
    ['scope', primary.scope, expected.scope],
    ['likelyCause', primary.likelyCause, expected.likelyCause],
  ];
  for (const [path, actual, value] of exact) {
    if (actual !== value) ctx.addIssue({ code: 'custom', path: [path], message: `${path} does not match incident code` });
  }
  if (!expected.severities.includes(primary.severity)) ctx.addIssue({ code: 'custom', path: ['severity'], message: 'severity does not match incident code' });
  if (!expected.confidences.includes(primary.confidence)) ctx.addIssue({ code: 'custom', path: ['confidence'], message: 'confidence does not match incident code' });
  if (JSON.stringify(primary.safeNextChecks) !== JSON.stringify(expected.checks)) {
    ctx.addIssue({ code: 'custom', path: ['safeNextChecks'], message: 'safeNextChecks do not match incident code' });
  }
  if (new Set(primary.evidence.map((item) => item.path)).size !== primary.evidence.length) {
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'evidence paths must be unique' });
  }
});

const secondarySignalSchema = z.object({
  code: z.enum(['XRAY_PROTOCOL_UNVERIFIED', 'HYSTERIA2_PROTOCOL_UNVERIFIED']),
  severity: z.literal('info'),
}).strict();

const diagnosisSchema = z.object({
  version: z.literal(1),
  state: z.enum(['healthy', 'uncertain', 'incident']),
  primary: primarySchema.nullable(),
  secondarySignals: z.array(secondarySignalSchema).max(2),
}).strict().superRefine((diagnosis, ctx) => {
  if (diagnosis.state === 'incident' && !diagnosis.primary) ctx.addIssue({ code: 'custom', path: ['primary'], message: 'incident requires primary diagnosis' });
  if (diagnosis.state !== 'incident' && diagnosis.primary) ctx.addIssue({ code: 'custom', path: ['primary'], message: 'non-incident cannot have primary diagnosis' });
  if (new Set(diagnosis.secondarySignals.map((item) => item.code)).size !== diagnosis.secondarySignals.length) {
    ctx.addIssue({ code: 'custom', path: ['secondarySignals'], message: 'secondary signals must be unique' });
  }
});

function valueAtPath(value, path) {
  return path.split('.').reduce((current, key) => current && current[key], value);
}

const failed = (status) => ['degraded', 'unavailable'].includes(status);
const xrayFailed = (health) => failed(health.xray.config) || failed(health.xray.service) || failed(health.xray.listener);
const hysteria2Failed = (health) => failed(health.hysteria2.config) || failed(health.hysteria2.service)
  || failed(health.hysteria2.listener) || failed(health.hysteria2.authEndpoint) || failed(health.hysteria2.authCredentialProbe)
  || (failed(health.hysteria2.auth) && health.hysteria2.authEndpoint === 'healthy' && ['healthy', 'unknown'].includes(health.hysteria2.authCredentialProbe));

function incidentMatchesSnapshot(health, code) {
  const checks = {
    VPN_SNAPSHOT_INVALID: () => false,
    HOST_UNAVAILABLE: () => failed(health.host),
    HOST_DNS_FAILURE: () => !xrayFailed(health) && !hysteria2Failed(health) && failed(health.network.dns),
    HOST_OUTBOUND_FAILURE: () => !xrayFailed(health) && !hysteria2Failed(health) && !failed(health.network.dns) && failed(health.network.outbound),
    XRAY_CONFIG_FAILURE: () => failed(health.xray.config) && !hysteria2Failed(health),
    XRAY_SERVICE_FAILURE: () => !failed(health.xray.config) && failed(health.xray.service) && !hysteria2Failed(health),
    XRAY_LISTENER_FAILURE: () => !failed(health.xray.config) && !failed(health.xray.service) && failed(health.xray.listener) && !hysteria2Failed(health),
    HYSTERIA2_CONFIG_FAILURE: () => failed(health.hysteria2.config) && !xrayFailed(health),
    HYSTERIA2_SERVICE_FAILURE: () => !failed(health.hysteria2.config) && failed(health.hysteria2.service) && !xrayFailed(health),
    HYSTERIA2_AUTH_ENDPOINT_FAILURE: () => !failed(health.hysteria2.config) && !failed(health.hysteria2.service) && failed(health.hysteria2.authEndpoint) && !xrayFailed(health),
    HYSTERIA2_AUTH_CREDENTIAL_FAILURE: () => !failed(health.hysteria2.config) && !failed(health.hysteria2.service) && !failed(health.hysteria2.authEndpoint) && failed(health.hysteria2.authCredentialProbe) && !xrayFailed(health),
    HYSTERIA2_LISTENER_FAILURE: () => !failed(health.hysteria2.config) && !failed(health.hysteria2.service) && !failed(health.hysteria2.authEndpoint) && !failed(health.hysteria2.authCredentialProbe) && failed(health.hysteria2.listener) && !xrayFailed(health),
    VPN_MULTI_STACK_FAILURE: () => xrayFailed(health) && hysteria2Failed(health),
    UNKNOWN_VPN_FAILURE: () => [health.host, health.network.dns, health.network.outbound,
      health.xray.service, health.xray.config, health.xray.listener,
      health.hysteria2.service, health.hysteria2.config, health.hysteria2.listener,
      health.hysteria2.auth, health.hysteria2.authEndpoint].includes('unknown')
      || failed(health.xray.protocolProbe) || failed(health.hysteria2.protocolProbe)
      || (failed(health.hysteria2.auth) && !failed(health.hysteria2.authEndpoint) && !failed(health.hysteria2.authCredentialProbe)),
  };
  return checks[code]();
}

const vpnHealthSchema = rawVpnHealthSchema.extend({ diagnosis: diagnosisSchema }).strict().superRefine((health, ctx) => {
  const requiredStatuses = [health.host, health.network.dns, health.network.outbound,
    health.xray.service, health.xray.config, health.xray.listener,
    health.hysteria2.service, health.hysteria2.config, health.hysteria2.listener,
    health.hysteria2.auth, health.hysteria2.authEndpoint];
  const requiredHealthy = requiredStatuses.every((status) => status === 'healthy')
    && ['healthy', 'unknown'].includes(health.hysteria2.authCredentialProbe)
    && ['healthy', 'unknown'].includes(health.xray.protocolProbe)
    && ['healthy', 'unknown'].includes(health.hysteria2.protocolProbe);
  if (health.diagnosis.state === 'healthy' && !requiredHealthy) {
    ctx.addIssue({ code: 'custom', path: ['diagnosis', 'state'], message: 'healthy diagnosis does not match snapshot' });
  }
  if (health.diagnosis.state === 'uncertain' && (requiredStatuses.some(failed) || !requiredStatuses.includes('unknown'))) {
    ctx.addIssue({ code: 'custom', path: ['diagnosis', 'state'], message: 'uncertain diagnosis does not match snapshot' });
  }
  if (health.diagnosis.primary) {
    if (!incidentMatchesSnapshot(health, health.diagnosis.primary.code)) {
      ctx.addIssue({ code: 'custom', path: ['diagnosis', 'primary', 'code'], message: 'incident code does not match snapshot' });
    }
    for (const [index, item] of health.diagnosis.primary.evidence.entries()) {
      if (valueAtPath(health, item.path) !== item.status) {
        ctx.addIssue({ code: 'custom', path: ['diagnosis', 'primary', 'evidence', index, 'status'], message: 'evidence does not match snapshot' });
      }
    }
  }
  const expectedSignals = [];
  if (health.xray.protocolProbe === 'unknown') expectedSignals.push('XRAY_PROTOCOL_UNVERIFIED');
  if (health.hysteria2.protocolProbe === 'unknown') expectedSignals.push('HYSTERIA2_PROTOCOL_UNVERIFIED');
  if (JSON.stringify(health.diagnosis.secondarySignals.map((item) => item.code)) !== JSON.stringify(expectedSignals)) {
    ctx.addIssue({ code: 'custom', path: ['diagnosis', 'secondarySignals'], message: 'secondary signals do not match snapshot' });
  }
});

function parseVpnHealth(value) {
  return vpnHealthSchema.parse(value);
}

module.exports = { INCIDENT_DEFINITIONS, diagnosisSchema, parseVpnHealth, rawVpnHealthSchema, vpnHealthSchema };
