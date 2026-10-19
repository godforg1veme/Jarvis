const { z } = require('zod');
const { defaultJobSettings } = require('./jobSearchDefaults');

const uuid = z.uuid();
const scopeSchema = z.object({ userId: uuid, conversationId: uuid,
  chatId: z.string().regex(/^\d{1,20}$/), channel: z.literal('telegram') }).strict();
const settingsSchema = z.object({
  queries: z.array(z.string().trim().min(2).max(200)).min(1).max(100),
  exclusions: z.array(z.string().trim().min(1).max(100)).max(50),
  targetRub: z.number().int().min(1).max(100000000), officeCity: z.string().min(1).max(120),
  remote: z.boolean(), historyDays: z.number().int().min(1).max(30),
  intervalMs: z.number().int().min(60000).max(86400000), budgetUsd: z.number().positive().max(10000),
  model: z.string().max(255), paused: z.boolean(), activated: z.boolean(),
}).strict();
const profileSchema = z.object({
  confirmed: z.boolean(),
  baseLetter: z.string().max(10000).default(''),
  facts: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    text: z.string().trim().min(1).max(2000), confirmed: z.literal(true) }).strict()).max(80),
  examples: z.array(z.string().trim().min(1).max(6000)).max(10),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.facts.map((x) => x.id)).size !== value.facts.length) ctx.addIssue({ code: 'custom', message: 'Duplicate fact IDs' });
});

function jobError(code) { const error = new Error(code); error.code = code; return error; }
async function assertUserJobAccess(db, accessService, userId) {
  if (!accessService?.repository?.get) throw jobError('JOB_SCOPE_DENIED');
  const access = await accessService.repository.get(db, 'user', uuid.parse(userId));
  if (!access || access.blocked || !access.permissions.includes('jobs')) throw jobError('JOB_SCOPE_DENIED');
  return access;
}

async function assertJobScope(pool, input, accessService) {
  const scope = scopeSchema.parse(input);
  await assertUserJobAccess(pool, accessService, scope.userId);
  const result = await pool.query(`SELECT c.id FROM conversations c JOIN users u ON u.id=c.user_id
    JOIN user_identities i ON i.user_id=c.user_id AND i.provider='telegram' AND i.external_id=$3
    WHERE c.id=$1 AND c.user_id=$2 AND c.channel='telegram' AND c.external_chat_id=$3`,
  [scope.conversationId, scope.userId, scope.chatId]);
  if (!result.rowCount) throw jobError('JOB_SCOPE_DENIED');
  return scope;
}

module.exports = { uuid, scopeSchema, settingsSchema, profileSchema, defaultJobSettings, jobError, assertUserJobAccess, assertJobScope };
