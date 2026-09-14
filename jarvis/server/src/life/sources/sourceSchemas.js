const { boundedText, safeJsonSchema, z } = require('../lifeV2SchemaUtils');

const LIFE_SOURCE_TYPES = Object.freeze([
  'calendar', 'email', 'tasks', 'receipts', 'deliveries', 'travel', 'subscriptions', 'smart_home',
]);

const createSourceConnectionSchema = z.object({
  adapterType: z.enum(LIFE_SOURCE_TYPES),
  displayName: boundedText(160),
  enabled: z.boolean().default(false),
  selectedScope: safeJsonSchema(4096, 'object').default({}),
  privacyPolicyVersion: z.number().int().min(1).max(1000).default(1),
  configurationMetadata: safeJsonSchema(4096, 'object').default({}),
}).strict();

const updateSourceConnectionSchema = z.object({
  revision: z.number().int().min(1),
  displayName: boundedText(160).optional(),
  enabled: z.boolean().optional(),
  selectedScope: safeJsonSchema(4096, 'object').optional(),
  privacyPolicyVersion: z.number().int().min(1).max(1000).optional(),
  configurationMetadata: safeJsonSchema(4096, 'object').optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'revision'), 'source update is empty');

module.exports = { LIFE_SOURCE_TYPES, createSourceConnectionSchema, updateSourceConnectionSchema };
