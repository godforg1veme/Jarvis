const { createHash, randomUUID } = require('node:crypto');
const { createReminderSchema, updateReminderSchema } = require('./reminderSchemas');

function boundedLimit(value, fallback = 20, maximum = 100) {
  return Math.min(Math.max(Number(value) || fallback, 1), maximum);
}

function occurrenceKey(idempotencyKey, triggerAt) {
  const occurrenceHash = createHash('sha256')
    .update(`${idempotencyKey}\0${new Date(triggerAt).toISOString()}`, 'utf8')
    .digest('hex');
  return `reminder:${occurrenceHash}`;
}

class ReminderRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ userId, ...raw }) {
    const input = createReminderSchema.parse(raw);
    const nextOccurrenceKey = occurrenceKey(input.idempotencyKey, input.triggerAt);
    const result = await this.pool.query(`
      INSERT INTO life_reminders (
        user_id, commitment_id, project_id, person_id, title, trigger_at, timezone,
        recurrence, delivery_channels, origin_channel, origin_conversation_id,
        origin_device_id, idempotency_key, occurrence_key, next_attempt_at, expires_at
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text[], $10, $11, $12, $13, $14, $15, $16
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
      input.idempotencyKey, nextOccurrenceKey, new Date(input.triggerAt), input.expiresAt ? new Date(input.expiresAt) : null]);
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
      const current = await this.get({ userId, reminderId });
      if (!current || current.revision !== input.revision) return null;
      add('occurrence_key', occurrenceKey(current.idempotency_key, input.triggerAt));
      add('attempt_count', 0);
      add('last_error_code', null);
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
          AND attempt_count < 20
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
    `, [claimToken, new Date(now), boundedLimit(limit, 20, 50)]);
    return { claimToken, reminders: result.rows };
  }

  async transitionClaim({ userId, reminderId, claimToken, state, nextAttemptAt = null, errorCode = null }) {
    if (!['scheduled', 'delivered', 'expired', 'failed', 'outcome_unknown'].includes(state)) throw new Error('invalid reminder transition');
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

  async completeClaim({ userId, reminderId, claimToken, nextTriggerAt = null, nextOccurrenceKey = null }) {
    const recurring = Boolean(nextTriggerAt && nextOccurrenceKey);
    const result = await this.pool.query(`
      UPDATE life_reminders
      SET state = $4, claim_token = NULL, claimed_at = NULL,
        trigger_at = COALESCE($5, trigger_at), next_attempt_at = COALESCE($5, next_attempt_at),
        occurrence_key = COALESCE($6, occurrence_key), attempt_count = CASE WHEN $5::timestamptz IS NULL THEN attempt_count ELSE 0 END,
        last_error_code = NULL, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND state = 'claimed' AND claim_token = $3
      RETURNING *
    `, [reminderId, userId, claimToken, recurring ? 'scheduled' : 'delivered',
      recurring ? new Date(nextTriggerAt) : null, recurring ? nextOccurrenceKey : null]);
    return result.rows[0] || null;
  }

  async acknowledge({ userId, reminderId, revision }) {
    const result = await this.pool.query(`
      WITH acknowledged AS (
        UPDATE life_reminder_deliveries SET acknowledged_at = now(), updated_at = now()
        WHERE id = (
          SELECT delivery.id FROM life_reminder_deliveries delivery
          JOIN life_reminders reminder ON reminder.id = delivery.reminder_id AND reminder.user_id = delivery.user_id
          WHERE reminder.id = $1 AND reminder.user_id = $2 AND reminder.revision = $3
            AND reminder.state IN ('scheduled', 'delivered') AND delivery.state = 'delivered'
            AND delivery.acknowledged_at IS NULL
          ORDER BY delivery.updated_at DESC, delivery.id DESC LIMIT 1
        )
        RETURNING reminder_id, user_id
      )
      UPDATE life_reminders reminder
      SET state = CASE WHEN reminder.recurrence IS NULL THEN 'acknowledged' ELSE reminder.state END,
        revision = revision + 1, updated_at = now()
      FROM acknowledged
      WHERE reminder.id = acknowledged.reminder_id AND reminder.user_id = acknowledged.user_id
      RETURNING reminder.*
    `, [reminderId, userId, revision]);
    return result.rows[0] || null;
  }

  async acknowledgeLatest({ userId, reminderId, originConversationId }) {
    const result = await this.pool.query(`
      WITH acknowledged AS (
        UPDATE life_reminder_deliveries SET acknowledged_at = now(), updated_at = now()
        WHERE id = (
          SELECT delivery.id FROM life_reminder_deliveries delivery
          JOIN life_reminders reminder ON reminder.id = delivery.reminder_id AND reminder.user_id = delivery.user_id
          WHERE reminder.id = $1 AND reminder.user_id = $2 AND reminder.origin_conversation_id = $3
            AND reminder.state IN ('scheduled', 'delivered') AND delivery.state = 'delivered'
            AND delivery.acknowledged_at IS NULL
          ORDER BY delivery.updated_at DESC, delivery.id DESC LIMIT 1
        )
        RETURNING reminder_id, user_id
      )
      UPDATE life_reminders reminder
      SET state = CASE WHEN reminder.recurrence IS NULL THEN 'acknowledged' ELSE reminder.state END,
        revision = revision + 1, updated_at = now()
      FROM acknowledged
      WHERE reminder.id = acknowledged.reminder_id AND reminder.user_id = acknowledged.user_id
      RETURNING reminder.*
    `, [reminderId, userId, originConversationId]);
    return result.rows[0] || null;
  }

  async beginDelivery({ userId, reminderId, occurrenceKey: key, channel, deliveryKey }) {
    const result = await this.pool.query(`
      INSERT INTO life_reminder_deliveries (
        user_id, reminder_id, occurrence_key, channel, delivery_key, state, attempt_count
      )
      SELECT $1, $2, $3, $4, $5, 'sending', 1
      WHERE EXISTS (SELECT 1 FROM life_reminders WHERE id = $2 AND user_id = $1 AND occurrence_key = $3)
      ON CONFLICT (user_id, delivery_key) DO NOTHING
      RETURNING *
    `, [userId, reminderId, key, channel, deliveryKey]);
    if (result.rows[0]) return { ...result.rows[0], canSend: true };
    const existing = await this.pool.query(`
      SELECT * FROM life_reminder_deliveries
      WHERE user_id = $1 AND reminder_id = $2 AND occurrence_key = $3
        AND channel = $4 AND delivery_key = $5
    `, [userId, reminderId, key, channel, deliveryKey]);
    return existing.rows[0] ? { ...existing.rows[0], canSend: false } : null;
  }

  async finishDelivery({ userId, deliveryId, deliveryKey, state, errorCode = null }) {
    if (!['delivered', 'failed', 'outcome_unknown'].includes(state)) throw new Error('invalid delivery transition');
    const safeError = errorCode ? (String(errorCode).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'DELIVERY_FAILED') : null;
    const result = await this.pool.query(`
      UPDATE life_reminder_deliveries
      SET state = $4, error_code = $5, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND delivery_key = $3 AND state = 'sending'
      RETURNING *
    `, [deliveryId, userId, deliveryKey, state, safeError]);
    return result.rows[0] ? { ...result.rows[0], canSend: true } : null;
  }

  async retryDelivery({ userId, deliveryId, deliveryKey }) {
    const result = await this.pool.query(`
      UPDATE life_reminder_deliveries
      SET state = 'sending', attempt_count = attempt_count + 1, error_code = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND delivery_key = $3
        AND state = 'failed' AND attempt_count < 20
      RETURNING *
    `, [deliveryId, userId, deliveryKey]);
    return result.rows[0] ? { ...result.rows[0], canSend: true } : null;
  }

  async countDeliveredSince({ userId, since }) {
    const result = await this.pool.query(`
      SELECT count(*)::integer AS count FROM life_reminder_deliveries
      WHERE user_id = $1 AND state = 'delivered' AND updated_at >= $2
    `, [userId, new Date(since)]);
    return Number(result.rows[0]?.count || 0);
  }

  async markStaleClaimsUnknown({ before }) {
    const result = await this.pool.query(`
      UPDATE life_reminders
      SET state = 'outcome_unknown', claim_token = NULL, claimed_at = NULL,
        last_error_code = 'STALE_DELIVERY_CLAIM', revision = revision + 1, updated_at = now()
      WHERE state = 'claimed' AND claimed_at < $1
      RETURNING id, user_id, occurrence_key
    `, [new Date(before)]);
    return result.rows;
  }

  async listUnknownDeliveries({ limit = 20 }) {
    const result = await this.pool.query(`
      SELECT delivery.*, reminder.title, reminder.timezone, reminder.recurrence,
        reminder.trigger_at, reminder.idempotency_key, reminder.delivery_channels,
        reminder.origin_conversation_id, reminder.origin_device_id,
        reminder.revision AS reminder_revision
      FROM life_reminder_deliveries delivery
      JOIN life_reminders reminder
        ON reminder.id = delivery.reminder_id AND reminder.user_id = delivery.user_id
      WHERE reminder.state = 'outcome_unknown'
        AND delivery.state IN ('sending', 'outcome_unknown')
      ORDER BY delivery.updated_at, delivery.id
      LIMIT $1
    `, [boundedLimit(limit, 20, 50)]);
    return result.rows;
  }

  async reconcileDelivery({ userId, deliveryId, deliveryKey, state, errorCode = null }) {
    if (!['delivered', 'failed', 'outcome_unknown'].includes(state)) throw new Error('invalid reconciliation state');
    const safeError = errorCode ? (String(errorCode).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'DELIVERY_FAILED') : null;
    const result = await this.pool.query(`
      UPDATE life_reminder_deliveries SET state = $4, error_code = $5, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND delivery_key = $3
        AND state IN ('sending', 'outcome_unknown')
      RETURNING *
    `, [deliveryId, userId, deliveryKey, state, safeError]);
    return result.rows[0] || null;
  }

  async occurrenceDelivered({ userId, reminderId, key, expectedChannels }) {
    const result = await this.pool.query(`
      SELECT count(*)::integer AS delivered
      FROM life_reminder_deliveries
      WHERE user_id = $1 AND reminder_id = $2 AND occurrence_key = $3
        AND channel = ANY($4::text[]) AND state = 'delivered'
    `, [userId, reminderId, key, expectedChannels]);
    return Number(result.rows[0]?.delivered || 0) === expectedChannels.length;
  }

  async completeUnknown({ userId, reminderId, revision, nextTriggerAt = null, nextOccurrenceKey = null }) {
    const recurring = Boolean(nextTriggerAt && nextOccurrenceKey);
    const result = await this.pool.query(`
      UPDATE life_reminders
      SET state = $4, trigger_at = COALESCE($5, trigger_at), next_attempt_at = COALESCE($5, next_attempt_at),
        occurrence_key = COALESCE($6, occurrence_key), attempt_count = CASE WHEN $5::timestamptz IS NULL THEN attempt_count ELSE 0 END,
        last_error_code = NULL, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3 AND state = 'outcome_unknown'
      RETURNING *
    `, [reminderId, userId, revision, recurring ? 'scheduled' : 'delivered',
      recurring ? new Date(nextTriggerAt) : null, recurring ? nextOccurrenceKey : null]);
    return result.rows[0] || null;
  }

  async transitionUnknown({ userId, reminderId, revision, state, errorCode }) {
    if (!['failed', 'delivered'].includes(state)) throw new Error('invalid unknown transition');
    const safeError = errorCode ? (String(errorCode).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'DELIVERY_FAILED') : null;
    const result = await this.pool.query(`
      UPDATE life_reminders
      SET state = $4, last_error_code = $5, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3 AND state = 'outcome_unknown'
      RETURNING *
    `, [reminderId, userId, revision, state, safeError]);
    return result.rows[0] || null;
  }
}

module.exports = { ReminderRepository, occurrenceKey };
