const { z } = require('zod');
const { recurrenceSchema, timezoneSchema } = require('../life/reminders/reminderSchemas');

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const title = z.string().trim().min(1).max(300);
const schemas = Object.freeze({
  'reminder.create': z.object({
    requestId: id, title, triggerAt: timestamp, timezone: timezoneSchema,
    recurrence: recurrenceSchema.nullable().optional(), deliveryChannels: z.array(z.enum(['telegram', 'desktop'])).min(1).max(2),
    commitmentId: id.nullable().optional(), projectId: id.nullable().optional(), personId: id.nullable().optional(),
  }).strict(),
  'reminder.reschedule': z.object({
    reminderId: id, revision: z.number().int().min(1), triggerAt: timestamp,
    timezone: timezoneSchema.optional(), recurrence: recurrenceSchema.nullable().optional(),
  }).strict(),
  'life.commitment.reschedule': z.object({
    commitmentId: id, revision: z.number().int().min(1), dueAt: timestamp, dueWindowEndAt: timestamp.nullable().optional(),
  }).strict().refine((value) => !value.dueWindowEndAt || new Date(value.dueWindowEndAt) >= new Date(value.dueAt), 'invalid due window'),
  'life.task.create': z.object({
    sourceEventId: id, title, projectId: id.nullable().optional(), personId: id.nullable().optional(),
    dueAt: timestamp.nullable().optional(), dueWindowEndAt: timestamp.nullable().optional(),
  }).strict(),
  'project.show_documents': z.object({ projectId: id }).strict(),
  'device.status.request': z.object({ deviceId: id }).strict(),
  'workflow.continue': z.object({ workflowId: id }).strict(),
  'workspace.prepare': z.object({ projectId: id, recoveryPlanId: id.optional(),
    capabilityClasses: z.array(z.enum(['applications', 'files', 'windows'])).min(1).max(3).optional() }).strict(),
});

function validateLifeActionArgs(action, input) {
  const schema = schemas[action];
  if (!schema) throw new Error(`unknown Life action: ${action}`);
  return schema.parse(input || {});
}

module.exports = { LIFE_ACTION_SCHEMAS: schemas, validateLifeActionArgs };
