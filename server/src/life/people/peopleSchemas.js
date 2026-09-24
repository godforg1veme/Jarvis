const {
  boundedText, idSchema, optionalId, timestampSchema, z,
} = require('../lifeV2SchemaUtils');

const RELATIONSHIP_TYPES = Object.freeze(['family', 'partner', 'friend', 'colleague', 'client', 'provider', 'other']);
const RELATION_DIRECTIONS = Object.freeze(['owner_to_person', 'person_to_owner', 'mutual', 'person_to_person']);
const PROJECT_ROLES = Object.freeze(['participant', 'stakeholder', 'assignee', 'beneficiary', 'other']);
const FAMILY_RESOURCE_TYPES = Object.freeze(['area', 'project', 'event_category', 'commitment', 'calendar_source']);
const FAMILY_PERMISSIONS = Object.freeze(['view_summary', 'contribute_event', 'acknowledge']);

const aliasesSchema = z.array(boundedText(160)).max(16)
  .refine((items) => new Set(items.map((item) => item.toLocaleLowerCase())).size === items.length, 'aliases must be unique');

const createPersonSchema = z.object({
  displayName: boundedText(160),
  aliases: aliasesSchema.default([]),
  relationshipType: z.enum(RELATIONSHIP_TYPES).default('other'),
  notes: z.string().trim().max(1000).default(''),
}).strict();

const updatePersonSchema = z.object({
  revision: z.number().int().min(1),
  displayName: boundedText(160).optional(),
  aliases: aliasesSchema.optional(),
  relationshipType: z.enum(RELATIONSHIP_TYPES).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'revision'), 'person update is empty');

const createRelationshipSchema = z.object({
  personId: idSchema,
  relatedPersonId: optionalId,
  direction: z.enum(RELATION_DIRECTIONS).default('mutual'),
  relationType: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  origin: z.literal('user').default('user'),
  confidence: z.literal(1).default(1),
}).strict().superRefine((value, context) => {
  const personToPerson = value.direction === 'person_to_person';
  if (personToPerson !== Boolean(value.relatedPersonId)) {
    context.addIssue({ code: 'custom', message: 'person-to-person direction requires a related person', path: ['relatedPersonId'] });
  }
  if (value.relatedPersonId && value.relatedPersonId === value.personId) {
    context.addIssue({ code: 'custom', message: 'a person cannot relate to itself', path: ['relatedPersonId'] });
  }
});

const createPersonProjectLinkSchema = z.object({
  personId: idSchema,
  projectId: idSchema,
  role: z.enum(PROJECT_ROLES),
}).strict();

const createFamilyGrantSchema = z.object({
  memberUserId: idSchema,
  resourceType: z.enum(FAMILY_RESOURCE_TYPES),
  resourceId: idSchema,
  permission: z.enum(FAMILY_PERMISSIONS),
  startsAt: timestampSchema.optional(),
  expiresAt: timestampSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  const startsAt = value.startsAt ? new Date(value.startsAt) : new Date();
  if (value.expiresAt && new Date(value.expiresAt) <= startsAt) {
    context.addIssue({ code: 'custom', message: 'family grant expiry must follow its start', path: ['expiresAt'] });
  }
});

const revokeFamilyGrantSchema = z.object({
  revision: z.number().int().min(1),
}).strict();

module.exports = {
  FAMILY_PERMISSIONS,
  FAMILY_RESOURCE_TYPES,
  PROJECT_ROLES,
  RELATIONSHIP_TYPES,
  RELATION_DIRECTIONS,
  createFamilyGrantSchema,
  createPersonProjectLinkSchema,
  createPersonSchema,
  createRelationshipSchema,
  revokeFamilyGrantSchema,
  updatePersonSchema,
};
