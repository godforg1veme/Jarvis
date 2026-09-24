const { z } = require('zod');

const guidanceSchema = z.object({
  responseLength: z.enum(['concise', 'balanced', 'detailed']),
  initiative: z.enum(['minimal', 'normal', 'high']),
  interruptionPolicy: z.enum(['normal', 'focus', 'defer_non_urgent', 'quiet', 'critical_only']),
  tone: z.enum(['neutral', 'calm', 'direct']),
  emotionalAdaptation: z.boolean(),
  uncertaintyLanguage: z.literal(true),
}).strict();

const contextItemSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  title: z.string().trim().max(300).optional(),
  summary: z.string().trim().max(1000).optional(),
  projectName: z.string().trim().max(160).nullable().optional(),
  areaName: z.string().trim().max(100).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.string().trim().max(40).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  trust: z.enum(['trusted', 'user', 'inferred']).optional(),
}).strict();

const namedContextSchema = z.object({
  name: z.string().trim().min(1).max(160),
  status: z.string().trim().max(40).nullable().optional(),
}).strict();

const lifeContextSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  currentArea: namedContextSchema.nullable(),
  currentProject: namedContextSchema.nullable(),
  items: z.array(contextItemSchema).max(40),
  sourceStatus: z.enum(['fresh', 'partial', 'stale']),
}).strict();

function normalizeCommunicationGuidance(value) {
  if (!value || typeof value !== 'object') return null;
  const parsed = guidanceSchema.safeParse({
    responseLength: value.responseLength,
    initiative: value.initiative,
    interruptionPolicy: value.interruptionPolicy,
    tone: value.tone,
    emotionalAdaptation: value.emotionalAdaptation,
    uncertaintyLanguage: value.uncertaintyLanguage,
  });
  return parsed.success ? parsed.data : null;
}

function normalizeLifeContext(value) {
  if (!value || typeof value !== 'object') return null;
  const parsed = lifeContextSchema.safeParse({
    asOf: value.asOf,
    currentArea: value.currentArea,
    currentProject: value.currentProject,
    items: value.items,
    sourceStatus: value.sourceStatus,
  });
  return parsed.success ? parsed.data : null;
}

module.exports = {
  guidanceSchema,
  lifeContextSchema,
  normalizeCommunicationGuidance,
  normalizeLifeContext,
};
