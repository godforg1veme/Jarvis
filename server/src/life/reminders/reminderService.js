const { createHash } = require('node:crypto');
const { z } = require('zod');
const { createReminderSchema, recurrenceSchema, timezoneSchema } = require('./reminderSchemas');
const { boundedText, idSchema, optionalId, timestampSchema } = require('../lifeV2SchemaUtils');

const reminderInputSchema = z.object({
  requestId: idSchema,
  commitmentId: optionalId,
  projectId: optionalId,
  personId: optionalId,
  title: boundedText(300),
  triggerAt: timestampSchema,
  timezone: timezoneSchema,
  expiresAt: timestampSchema.nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  deliveryChannels: z.array(z.enum(['telegram', 'desktop'])).min(1).max(2)
    .refine((items) => new Set(items).size === items.length, 'delivery channels must be unique'),
}).strict().refine((value) => !value.expiresAt || new Date(value.expiresAt) > new Date(value.triggerAt), {
  message: 'Reminder expiry must follow its trigger', path: ['expiresAt'],
});

function operationKey(userId, origin, requestId) {
  return `reminder:${createHash('sha256').update(`${userId}\0${origin.channel}\0${requestId}`).digest('hex')}`;
}

class ReminderService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway || null;
    this.now = options.now || (() => new Date());
  }

  async create({ userId, origin, input }) {
    const parsed = reminderInputSchema.parse(input);
    const { requestId, ...reminderInput } = parsed;
    const internal = createReminderSchema.parse({
      ...reminderInput,
      originChannel: origin.channel,
      originConversationId: origin.channel === 'telegram' ? origin.conversationId : origin.conversationId || null,
      originDeviceId: origin.channel === 'desktop' ? origin.deviceId : origin.deviceId || null,
      idempotencyKey: operationKey(userId, origin, requestId),
    });
    const reminder = await this.repository.create({ userId, ...internal });
    if (reminder) await this._record(userId, reminder, 'reminder.created', origin.deviceId);
    return reminder;
  }

  async reschedule({ userId, reminderId, revision, triggerAt, timezone, recurrence, sourceDeviceId = null }) {
    const reminder = await this.repository.update({ userId, reminderId, revision, triggerAt, timezone, recurrence });
    if (reminder) await this._record(userId, reminder, 'reminder.rescheduled', sourceDeviceId);
    return reminder;
  }

  async cancel({ userId, reminderId, revision, sourceDeviceId = null }) {
    const reminder = await this.repository.update({ userId, reminderId, revision, state: 'cancelled' });
    if (reminder) await this._record(userId, reminder, 'reminder.cancelled', sourceDeviceId);
    return reminder;
  }

  async acknowledge({ userId, reminderId, revision, sourceDeviceId = null }) {
    const reminder = await this.repository.acknowledge({ userId, reminderId, revision });
    if (reminder) await this._record(userId, reminder, 'reminder.acknowledged', sourceDeviceId);
    return reminder;
  }

  async acknowledgeLatest({ userId, reminderId, originConversationId }) {
    const reminder = await this.repository.acknowledgeLatest({ userId, reminderId, originConversationId });
    if (reminder) await this._record(userId, reminder, 'reminder.acknowledged');
    return reminder;
  }

  async _record(userId, reminder, eventType, sourceDeviceId = null) {
    if (!this.gateway) return;
    await this.gateway.record({
      userId, eventType, occurredAt: this.now(), sourceChannel: 'reminder', sourceDeviceId,
      sourceRef: `reminder:${reminder.id}:revision:${reminder.revision}`,
      deduplicationKey: `${eventType}:${reminder.id}:revision:${reminder.revision}`,
      summary: eventType === 'reminder.created' ? 'Напоминание создано' : 'Напоминание обновлено',
      structuredData: { reminderId: reminder.id, state: reminder.state, revision: reminder.revision },
      trustLevel: 'user', privacyClass: 'personal',
    });
  }
}

module.exports = { ReminderService, operationKey, reminderInputSchema };
