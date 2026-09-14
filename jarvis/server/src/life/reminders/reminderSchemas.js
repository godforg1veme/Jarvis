const {
  boundedText, idSchema, optionalId, timestampSchema, z,
} = require('../lifeV2SchemaUtils');

const weekdayList = z.array(z.number().int().min(1).max(7)).min(1).max(7)
  .refine((items) => new Set(items).size === items.length, 'weekdays must be unique');
const recurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), interval: z.number().int().min(1).max(365).default(1) }).strict(),
  z.object({ kind: z.literal('weekdays'), weekdays: weekdayList }).strict(),
  z.object({ kind: z.literal('weekly'), weekday: z.number().int().min(1).max(7), interval: z.number().int().min(1).max(52).default(1) }).strict(),
  z.object({ kind: z.literal('monthly_date'), day: z.number().int().min(1).max(31), interval: z.number().int().min(1).max(24).default(1) }).strict(),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(15).max(525600) }).strict(),
]);

const createReminderSchema = z.object({
  commitmentId: optionalId,
  projectId: optionalId,
  personId: optionalId,
  title: boundedText(300),
  triggerAt: timestampSchema,
  timezone: z.string().trim().min(1).max(80),
  recurrence: recurrenceSchema.nullable().optional(),
  deliveryChannels: z.array(z.enum(['telegram', 'desktop'])).min(1).max(2)
    .refine((items) => new Set(items).size === items.length, 'delivery channels must be unique'),
  originChannel: z.enum(['telegram', 'desktop', 'life_os']),
  originConversationId: optionalId,
  originDeviceId: optionalId,
  idempotencyKey: boundedText(256),
}).strict().superRefine((value, context) => {
  if (value.originChannel === 'telegram' && !value.originConversationId) {
    context.addIssue({ code: 'custom', message: 'Telegram reminder requires origin conversation', path: ['originConversationId'] });
  }
  if (value.originChannel === 'desktop' && !value.originDeviceId) {
    context.addIssue({ code: 'custom', message: 'Desktop reminder requires origin device', path: ['originDeviceId'] });
  }
});

const updateReminderSchema = z.object({
  revision: z.number().int().min(1),
  triggerAt: timestampSchema.optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  deliveryChannels: z.array(z.enum(['telegram', 'desktop'])).min(1).max(2).optional(),
  state: z.enum(['acknowledged', 'cancelled']).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'revision'), 'reminder update is empty');

module.exports = { createReminderSchema, recurrenceSchema, updateReminderSchema };
