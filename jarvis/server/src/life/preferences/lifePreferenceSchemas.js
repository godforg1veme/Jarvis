const { idSchema, z } = require('../lifeV2SchemaUtils');

const ruleNameSchema = z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,79}$/);
const preferenceValueSchemas = Object.freeze({
  'response.style': z.enum(['concise', 'balanced', 'detailed']),
  'contextual_adaptation.enabled': z.boolean(),
  'initiative.level': z.enum(['minimal', 'normal', 'high']),
  'notifications.quiet_hours': z.object({
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes: z.number().int().min(0).max(1439),
    timezone: z.string().trim().min(1).max(80),
  }).strict(),
  'notifications.max_proactive_per_day': z.number().int().min(0).max(50),
  'areas.priorities': z.array(z.object({ areaId: idSchema, weight: z.number().min(-1).max(1) }).strict()).max(32)
    .refine((items) => new Set(items.map((item) => item.areaId)).size === items.length, 'areas must be unique'),
  'proposal.suppressed_rules': z.array(ruleNameSchema).max(32)
    .refine((items) => new Set(items).size === items.length, 'rules must be unique'),
  'links.low_confidence_behavior': z.enum(['ask', 'show', 'ignore']),
  'reminders.default_lead_minutes': z.number().int().min(0).max(10080),
});

const preferenceInputEnvelopeSchema = z.object({
  key: z.enum(Object.keys(preferenceValueSchemas)),
  value: z.unknown(),
  revision: z.number().int().min(1).nullable().optional(),
}).strict();

function parsePreferenceInput(raw) {
  const input = preferenceInputEnvelopeSchema.parse(raw);
  return { ...input, value: preferenceValueSchemas[input.key].parse(input.value) };
}

module.exports = { PREFERENCE_KEYS: Object.freeze(Object.keys(preferenceValueSchemas)), parsePreferenceInput };
