const {
  boundedText, idSchema, opaqueReferenceSchema, optionalId, timestampSchema, z,
} = require('../lifeV2SchemaUtils');

const RECOVERY_STEP_TYPES = Object.freeze([
  'show_fact', 'show_document', 'open_application', 'open_file', 'restore_window',
  'continue_workflow', 'prepare_workspace', 'suggest_next_step',
]);

const recoveryStepSchema = z.object({
  position: z.number().int().min(0).max(31),
  stepType: z.enum(RECOVERY_STEP_TYPES),
  label: boundedText(300),
  riskClass: z.enum(['safe', 'changing']),
  actionName: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,127}$/).nullable().optional(),
  resourceRef: opaqueReferenceSchema.nullable().optional(),
  dependsOnPositions: z.array(z.number().int().min(0).max(31)).max(16).default([]),
}).strict().superRefine((value, context) => {
  if ((value.riskClass === 'changing') !== Boolean(value.actionName)) {
    context.addIssue({ code: 'custom', message: 'changing steps require one declared action', path: ['actionName'] });
  }
  if (value.dependsOnPositions.some((position) => position >= value.position)) {
    context.addIssue({ code: 'custom', message: 'steps may depend only on earlier positions', path: ['dependsOnPositions'] });
  }
});

const createRecoveryPlanSchema = z.object({
  projectId: idSchema,
  sourceContextRevision: z.number().int().min(0),
  summary: boundedText(1000),
  creationReason: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
  originChannel: z.enum(['telegram', 'desktop']),
  originConversationId: optionalId,
  originDeviceId: optionalId,
  idempotencyKey: boundedText(256),
  expiresAt: timestampSchema,
  steps: z.array(recoveryStepSchema).min(1).max(32)
    .refine((steps) => new Set(steps.map((step) => step.position)).size === steps.length, 'step positions must be unique'),
}).strict().superRefine((value, context) => {
  if (value.originChannel === 'telegram' && !value.originConversationId) {
    context.addIssue({ code: 'custom', message: 'Telegram recovery requires origin conversation', path: ['originConversationId'] });
  }
  if (value.originChannel === 'desktop' && !value.originDeviceId) {
    context.addIssue({ code: 'custom', message: 'Desktop recovery requires origin device', path: ['originDeviceId'] });
  }
});

module.exports = { RECOVERY_STEP_TYPES, createRecoveryPlanSchema, recoveryStepSchema };
