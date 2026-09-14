const { createHash, randomUUID } = require('node:crypto');
const { createReminderSchema, updateReminderSchema } = require('./reminderSchemas');

function boundedLimit(value, fallback = 20, maximum = 100) {
  return Math.min(Math.max(Number(value) || fallback, 1), maximum);
}

class ReminderRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ userId, ...raw }) {
    const input = createReminderSchema.parse(raw);
    const occurrenceHash = createHash('sha256')
      .update(`${input.idempotencyKey}\0${new Date(input.triggerAt).toISOString()}`, 'utf8')
      .digest('hex');
    const occurrenceKey = `reminder:${occurrenceHash}`;
    const result = await this.pool.query(`
      INSERT INTO life_reminders (
        user_id, commitment_id, project_id, person_id, title, trigger_at, timezone,
        recurrence, delivery_channels, origin_channel, origin_conversation_id,
        origin_device_id, idempotency_key, occurrence_key, next_attempt_at
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text[], $10, $11, $12, $13, $14, $15
      WHERE ($2::uuid IS NULL OR EXISTS (
          SELECT 1 FROM life_commitments WHERE id = $2 AND user_id = $1
        ))
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM life_projects WHERE id = $3 AND user_id = $1
        ))
        AND ($4::uuid IS NULL OR EXISTS (
          SELECT 1 FROM life_people WHERE id = $4 AND user_id = $1
        ))
        AND ($11::uuid IS NULL OR EXISTS (
          SELECT 1 FROM conversations WHERE id = $11 AND user_id = $1
        ))
        AND ($12::uuid IS NULL OR EXISTS (
          SELECT 1 FROM devices WHERE id = $12 AND user_id = $1
        ))
      ON CONFLICT (user_id, idempotency_key)
      DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING *
    `, [userId, input.commitmentId || null, input.projectId || null, input.personId || null,
      input.title, new Date(input.triggerAt), input.timezone,
      input.recurrence ? JSON.stringify(input.recurrence) : null, input.deliveryChannels,
      input.originChannel, input.originConversationId || null, input.originDeviceId || null,
      input.idempotencyKey, occurrenceKey, new Date(input.triggerAt)]);
    return result.rows[0] || null;
  }

  async get({ userId, reminderId }) {
    const result = await this.pool.query(`
      SELECT * FROM life_reminders WHERE id = $1 AND user_id = $2
    `, [reminderId, userId]);
    return result.rows[0] || null;
  }

  async list({ userId, states = ['scheduled', 'claimed', 'outcome_unknown'], limit = 50 }) {
    const allowed = states.filter((state) => [
      'scheduled', 'claimed', 'delivered', 'acknowledged', 'cancelled', 'expired', 'failed', 'outcome_unknown',
    ].includes(state)).slice(0, 8);
    if (!allowed.length) return [];
    const result = await this.pool.query(`
      SELECT * FROM life_reminders
      WHERE user_id = $1 AND state = ANY($2::text[])
      ORDER BY trigger_at, id
      LIMIT $3
    `, [userId, allowed, boundedLimit(limit, 50, 100)]);
    return result.rows;
  }

  async update({ userId, reminderId, ...raw }) {
    const input = updateReminderSchema.parse(raw);
    const fields = [];
    const params = [reminderId, userId, input.revision];
    const add = (column, value, cast = '') => {
      params.push(value);
      fields.push(`${column} = $${params.length}${cast}`);
    };
    if (input.triggerAt !== undefined) {
      add('trigger_at', new Date(input.triggerAt));
      add('next_attempt_at', new Date(input.triggerAt));
    }
    if (input.timezone !== undefined) add('timezone', input.timezone);
    if (input.recurrence !== undefined) add('recurrence', input.recurrence ? JSON.stringify(input.recurrence) : null, '::jsonb');
    if (input.deliveryChannels !== undefined) add('delivery_channels', input.deliveryChannels, '::text[]');
    if (input.state !== undefined) add('state', input.state);
    const result = await this.pool.query(`
      UPDATE life_reminders
      SET ${fields.join(', ')}, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3
        AND state IN ('scheduled', 'failed', 'outcome_unknown')
      RETURNING *
    `, params);
    return result.rows[0] || null;
  }

  async claimDue({ now = new Date(), limit = 20 }) {
    const claimToken = randomUUID();
    const result = await this.pool.query(`
      WITH due AS (
        SELECT id, user_id
        FROM life_reminders
        WHERE state = 'scheduled' AND trigger_at <= $2 AND next_attempt_at <= $2
        ORDER BY next_attempt_at, trigger_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $3
      )
      UPDATE life_reminders reminder
      SET state = 'claimed', claim_token = $1, claimed_at = now(),
        attempt_count = attempt_count + 1, revision = revision + 1, updated_at = now()
      FROM due
      WHERE reminder.id = due.id AND reminder.user_id = due.user_id
      RETURNING reminder.*
    `, [claimToken, new Date(now), boundedLimit(limit)]);
    return { claimToken, reminders: result.rows };
  }

  async transitionClaim({ userId, reminderId, claimToken, state, nextAttemptAt = null, errorCode = null }) {
    if (!['scheduled', 'delivered', 'failed', 'outcome_unknown'].includes(state)) throw new Error('invalid reminder transition');
    const result = await this.pool.query(`
      UPDATE life_reminders
      SET state = $4, claim_token = NULL, claimed_at = NULL,
        next_attempt_at = COALESCE($5, next_attempt_at), last_error_code = $6,
        revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND state = 'claimed' AND claim_token = $3
      RETURNING *
    `, [reminderId, userId, claimToken, state,
      nextAttemptAt ? new Date(nextAttemptAt) : null,
      errorCode ? (String(errorCode).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'REMINDER_FAILED') : null]);
    return result.rows[0] || null;
  }
}

module.exports = { ReminderRepository };
