const { idSchema, timestampSchema, z } = require('../lifeV2SchemaUtils');

const LIFE_MODES = Object.freeze(['work', 'focus', 'home', 'family', 'meeting', 'travel', 'rest', 'sleep', 'emergency']);

const setLifeModeSchema = z.object({
  mode: z.enum(LIFE_MODES),
  source: z.enum(['manual', 'accepted_suggestion']).default('manual'),
  startsAt: timestampSchema.optional(),
  expiresAt: timestampSchema.nullable().optional(),
  transitionEventId: idSchema.nullable().optional(),
  revision: z.number().int().min(1).nullable().optional(),
}).strict().superRefine((value, context) => {
  const startsAt = value.startsAt ? new Date(value.startsAt) : new Date();
  if (value.expiresAt && new Date(value.expiresAt) <= startsAt) {
    context.addIssue({ code: 'custom', message: 'mode expiry must follow its start', path: ['expiresAt'] });
  }
});

const modeSelectionSchema = z.object({
  mode: z.enum(LIFE_MODES),
  expiresAt: timestampSchema.nullable().optional(),
  revision: z.number().int().min(1).nullable().optional(),
}).strict();

module.exports = { LIFE_MODES, modeSelectionSchema, setLifeModeSchema };
