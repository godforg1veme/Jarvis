const { z } = require('zod');

const LIFE_EVENT_TYPES = Object.freeze([
  'message.received',
  'voice.transcribed',
  'vision.observed',
  'document.ingested',
  'document.ingest_failed',
  'device.connected',
  'device.disconnected',
  'device.state_changed',
  'project.created',
  'project.updated',
  'project.archived',
  'commitment.detected',
  'commitment.updated',
  'commitment.completed',
  'task.created',
  'task.updated',
  'task.completed',
  'proposal.created',
  'proposal.dismissed',
  'proposal.confirmed',
  'proposal.expired',
  'workflow.started',
  'workflow.awaiting_confirmation',
  'workflow.completed',
  'workflow.failed',
  'workflow.outcome_unknown',
  'feedback.recorded',
  'person.created',
  'person.updated',
  'person.archived',
  'relationship.updated',
  'family_access.granted',
  'family_access.revoked',
  'mode.changed',
  'preference.updated',
  'preference.deleted',
  'reminder.created',
  'reminder.rescheduled',
  'reminder.cancelled',
  'reminder.delivered',
  'reminder.delivery_failed',
  'reminder.outcome_unknown',
  'recovery.prepared',
  'recovery.started',
  'recovery.completed',
  'recovery.failed',
  'recovery.outcome_unknown',
  'source.synced',
  'source.failed',
  'mission.pinned',
  'mission.hidden',
]);

const SOURCE_CHANNELS = Object.freeze([
  'telegram', 'desktop', 'voice', 'vision', 'knowledge', 'memory', 'device', 'orchestrator', 'life_os', 'backfill',
  'reminder', 'calendar', 'email', 'tasks', 'receipts', 'deliveries', 'travel', 'subscriptions', 'smart_home',
]);
const PRIVACY_CLASSES = Object.freeze(['personal', 'family', 'sensitive']);
const TRUST_LEVELS = Object.freeze(['trusted', 'inferred', 'user']);
const LINK_TARGET_TYPES = Object.freeze([
  'area', 'project', 'conversation', 'document', 'device', 'workflow', 'commitment', 'proposal', 'event', 'memory',
  'person', 'reminder', 'recovery_plan', 'source_connection',
]);
const LINK_ORIGINS = Object.freeze(['trusted', 'inferred', 'user']);
const PROJECT_STATUSES = Object.freeze(['active', 'paused', 'completed', 'archived']);
const COMMITMENT_STATUSES = Object.freeze(['open', 'completed', 'dismissed', 'expired']);
const PROPOSAL_STATUSES = Object.freeze(['open', 'confirmed', 'dismissed', 'expired', 'executing', 'completed', 'failed', 'outcome_unknown']);
const FEEDBACK_KINDS = Object.freeze(['useful', 'not_useful', 'incorrect_link', 'wrong_project', 'dismissed', 'suppress_similar']);

const idSchema = z.string().uuid();
const boundedText = (maximum) => z.string().trim().min(1).max(maximum);
const optionalId = idSchema.nullable().optional();
const timestampSchema = z.union([z.date(), z.string().datetime({ offset: true })]);

function byteLengthOfJson(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const SENSITIVE_STRUCTURED_KEY = /(?:audio|image|frame|ocr|body|content|secret|token|password|credential|cookie|authorization|local_?path|storage_?key|api_?key|bytes?)/iu;

function isSafeStructuredValue(value, depth = 0) {
  if (depth > 5 || Buffer.isBuffer(value)) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return value.length <= 2000;
  if (Array.isArray(value)) return value.length <= 64 && value.every((item) => isSafeStructuredValue(item, depth + 1));
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.length <= 64 && entries.every(([key, item]) => (
    !SENSITIVE_STRUCTURED_KEY.test(key) && isSafeStructuredValue(item, depth + 1)
  ));
}

const structuredDataSchema = z.record(z.string().min(1).max(80), z.unknown())
  .refine((value) => isSafeStructuredValue(value), 'structured data contains disallowed content')
  .refine((value) => byteLengthOfJson(value) <= 16384, 'structured data is too large');

const lifeEventInputSchema = z.object({
  userId: idSchema,
  eventType: z.enum(LIFE_EVENT_TYPES),
  occurredAt: timestampSchema,
  sourceChannel: z.enum(SOURCE_CHANNELS),
  sourceRef: boundedText(256),
  sourceDeviceId: optionalId,
  deduplicationKey: boundedText(512),
  summary: boundedText(1000),
  structuredData: structuredDataSchema.default({}),
  confidence: z.number().min(0).max(1).default(1),
  privacyClass: z.enum(PRIVACY_CLASSES).default('personal'),
  trustLevel: z.enum(TRUST_LEVELS).default('trusted'),
  correlationId: z.string().trim().max(128).nullable().optional(),
  causationEventId: optionalId,
}).strict();

const lifeEventLinkInputSchema = z.object({
  userId: idSchema,
  eventId: idSchema,
  targetType: z.enum(LINK_TARGET_TYPES),
  targetId: idSchema,
  relationType: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  origin: z.enum(LINK_ORIGINS),
  confidence: z.number().min(0).max(1),
}).strict();

const createAreaSchema = z.object({
  name: boundedText(100),
  key: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).default(0),
}).strict();

const createProjectSchema = z.object({
  areaId: optionalId,
  name: boundedText(160),
  summary: z.string().trim().max(2000).default(''),
  targetAt: timestampSchema.nullable().optional(),
}).strict();

const updateProjectSchema = z.object({
  revision: z.number().int().min(1),
  areaId: optionalId,
  name: boundedText(160).optional(),
  summary: z.string().trim().max(2000).optional(),
  targetAt: timestampSchema.nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'revision'), 'project update is empty');

const timelineQuerySchema = z.object({
  projectId: idSchema.optional(),
  areaId: idSchema.optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
}).strict();

const feedbackInputSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  targetType: z.enum(['event', 'link', 'project', 'commitment', 'proposal', 'person', 'mode', 'preference', 'reminder']),
  targetId: idSchema,
  note: z.string().trim().max(500).default(''),
}).strict();

const createCommitmentSchema = z.object({
  userId: idSchema,
  sourceEventId: idSchema,
  areaId: optionalId,
  projectId: optionalId,
  personId: optionalId,
  kind: z.enum(['commitment', 'task']).default('commitment'),
  title: boundedText(300),
  dueAt: timestampSchema.nullable().optional(),
  dueWindowEndAt: timestampSchema.nullable().optional(),
  recurrence: structuredDataSchema.nullable().optional(),
  externalSourceRef: z.string().trim().min(1).max(256).nullable().optional(),
  confidence: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  if (value.dueAt && value.dueWindowEndAt && new Date(value.dueWindowEndAt) < new Date(value.dueAt)) {
    context.addIssue({ code: 'custom', message: 'due window cannot end before it starts', path: ['dueWindowEndAt'] });
  }
});

const createProposalSchema = z.object({
  userId: idSchema,
  areaId: optionalId,
  projectId: optionalId,
  commitmentId: optionalId,
  personId: optionalId,
  reminderId: optionalId,
  title: boundedText(300),
  explanation: boundedText(2000),
  sourceRule: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,79}$/).default('core_v1'),
  sourceRuleVersion: z.number().int().min(1).max(1000).default(1),
  confidence: z.number().min(0).max(1).default(1),
  riskClass: z.enum(['safe', 'changing']),
  actionName: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,127}$/).nullable().optional(),
  actionArguments: z.record(z.string().min(1).max(80), z.unknown())
    .refine((value) => byteLengthOfJson(value) <= 8192, 'action arguments are too large')
    .default({}),
  originChannel: z.enum(['telegram', 'desktop']),
  originConversationId: optionalId,
  originDeviceId: optionalId,
  cooldownKey: boundedText(256),
  expiresAt: timestampSchema,
  evidenceEventIds: z.array(idSchema).min(1).max(32)
    .refine((items) => new Set(items).size === items.length, 'proposal evidence must be unique'),
}).strict().superRefine((value, context) => {
  if (value.originChannel === 'desktop' && !value.originDeviceId) {
    context.addIssue({ code: 'custom', message: 'Desktop proposal requires origin device', path: ['originDeviceId'] });
  }
  if (value.originChannel === 'telegram' && !value.originConversationId) {
    context.addIssue({ code: 'custom', message: 'Telegram proposal requires origin conversation', path: ['originConversationId'] });
  }
  if (value.riskClass === 'changing' && !value.actionName) {
    context.addIssue({ code: 'custom', message: 'Changing proposal requires a declared action', path: ['actionName'] });
  }
  if (value.riskClass === 'changing' && !value.originConversationId) {
    context.addIssue({ code: 'custom', message: 'Changing proposal requires an origin conversation', path: ['originConversationId'] });
  }
});

function parseLifeEventInput(input) {
  const parsed = lifeEventInputSchema.parse(input);
  return {
    ...parsed,
    occurredAt: new Date(parsed.occurredAt),
  };
}

module.exports = {
  COMMITMENT_STATUSES,
  FEEDBACK_KINDS,
  LIFE_EVENT_TYPES,
  LINK_ORIGINS,
  LINK_TARGET_TYPES,
  PRIVACY_CLASSES,
  PROJECT_STATUSES,
  PROPOSAL_STATUSES,
  SOURCE_CHANNELS,
  TRUST_LEVELS,
  createAreaSchema,
  createCommitmentSchema,
  createProjectSchema,
  createProposalSchema,
  feedbackInputSchema,
  idSchema,
  isSafeStructuredValue,
  lifeEventInputSchema,
  lifeEventLinkInputSchema,
  parseLifeEventInput,
  structuredDataSchema,
  timelineQuerySchema,
  updateProjectSchema,
};
