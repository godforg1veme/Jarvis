const { z } = require('zod');

const PROMPT_VERSION = 'vpn-supervisor-v1';
const CATALOG_VERSION = 'vpn-playbooks-v1';

const PLAYBOOK_IDS = Object.freeze([
  'restart_xray',
  'restart_hysteria2',
  'restore_xray_known_good',
  'restore_hysteria2_known_good',
  'supervisor_acceptance_noop',
]);

const REASON_CODES = Object.freeze([
  'SERVICE_FAILED',
  'CONFIG_INVALID',
  'INSUFFICIENT_EVIDENCE',
  'NO_SAFE_PLAYBOOK',
  'TEST_ACCEPTANCE',
]);

const REQUIRED_CHECKS = Object.freeze([
  'xray_config',
  'xray_listener',
  'hysteria2_config',
  'hysteria2_listener',
  'hysteria2_auth',
  'host_dns',
  'host_outbound',
]);

const evidenceEventSchema = z.object({
  id: z.string().regex(/^E[1-9][0-9]{0,2}$/),
  source: z.enum(['xray', 'hysteria2', 'host-agent', 'systemd', 'probe']),
  observedAt: z.string().datetime({ offset: true }),
  message: z.string().min(1).max(240),
  repetitions: z.number().int().min(1).max(1000),
}).strict();

const plannerContextSchema = z.object({
  version: z.literal(1),
  synthetic: z.boolean(),
  incident: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    scope: z.enum(['host', 'xray', 'hysteria2', 'multi', 'acceptance']),
    severity: z.enum(['warning', 'error', 'critical']),
    confidence: z.enum(['low', 'medium', 'high']),
  }).strict(),
  node: z.object({
    id: z.string().uuid(),
    label: z.string().min(1).max(100),
    capabilities: z.array(z.enum(PLAYBOOK_IDS)).max(PLAYBOOK_IDS.length),
  }).strict(),
  facts: z.array(z.object({
    id: z.string().regex(/^F[1-9][0-9]{0,2}$/),
    name: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
    status: z.enum(['healthy', 'degraded', 'failed', 'unavailable', 'unknown', 'synthetic']),
  }).strict()).min(1).max(30),
  evidence: z.array(evidenceEventSchema).max(40),
  evidenceTruncated: z.boolean(),
}).strict();

const plannerResponseSchema = z.object({
  version: z.literal(1),
  decision: z.enum(['propose', 'need_observation', 'stop']),
  playbookId: z.enum(PLAYBOOK_IDS).nullable(),
  reasonCode: z.enum(REASON_CODES),
  confidence: z.enum(['low', 'medium', 'high']),
  requiredChecks: z.array(z.enum(REQUIRED_CHECKS)).max(REQUIRED_CHECKS.length),
  evidenceRefs: z.array(z.string().regex(/^[EF][1-9][0-9]{0,2}$/)).max(20),
}).strict().superRefine((value, ctx) => {
  if (value.decision === 'propose' && !value.playbookId) {
    ctx.addIssue({ code: 'custom', path: ['playbookId'], message: 'proposal requires playbookId' });
  }
  if (value.decision !== 'propose' && value.playbookId !== null) {
    ctx.addIssue({ code: 'custom', path: ['playbookId'], message: 'non-proposal cannot select a playbook' });
  }
  if (value.decision !== 'need_observation' && value.requiredChecks.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['requiredChecks'], message: 'checks require need_observation' });
  }
});

module.exports = {
  CATALOG_VERSION,
  PLAYBOOK_IDS,
  PROMPT_VERSION,
  REASON_CODES,
  REQUIRED_CHECKS,
  evidenceEventSchema,
  plannerContextSchema,
  plannerResponseSchema,
};
