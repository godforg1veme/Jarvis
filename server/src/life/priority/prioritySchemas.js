const { idSchema, timestampSchema, z } = require('../lifeV2SchemaUtils');

const priorityIntentSchema = z.object({
  projectId: idSchema,
  revision: z.number().int().min(1).nullable().optional(),
  pinned: z.boolean(),
  hiddenUntil: timestampSchema.nullable().optional(),
  userWeight: z.number().min(-1).max(1).default(0),
}).strict();

const priorityCalculationSchema = z.object({
  projectId: idSchema,
  score: z.number().min(-1000).max(1000),
  confidence: z.number().min(0).max(1),
  factors: z.array(z.object({
    code: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
    contribution: z.number().min(-1000).max(1000),
  }).strict()).max(16),
  calculationVersion: z.number().int().min(1).max(1000),
}).strict();

module.exports = { priorityCalculationSchema, priorityIntentSchema };
