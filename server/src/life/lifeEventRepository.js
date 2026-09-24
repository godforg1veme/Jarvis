const { randomUUID } = require('node:crypto');
const { parseLifeEventInput } = require('./lifeSchemas');

const ERROR_CODE = /^[A-Z0-9_]{1,80}$/;

function boundedLimit(value, fallback = 40, maximum = 100) {
  return Math.min(Math.max(Number(value) || fallback, 1), maximum);
}

class LifeEventRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(input) {
    const event = parseLifeEventInput(input);
    const result = await this.pool.query(`
      INSERT INTO life_events (
        user_id, event_type, occurred_at, source_channel, source_ref,
        source_device_id, deduplication_key, summary, structured_data,
        confidence, privacy_class, trust_level, correlation_id, causation_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
      ON CONFLICT (user_id, deduplication_key) DO UPDATE
        SET deduplication_key = EXCLUDED.deduplication_key
      RETURNING *, (xmax = 0) AS inserted
    `, [event.userId, event.eventType, event.occurredAt, event.sourceChannel,
      event.sourceRef, event.sourceDeviceId || null, event.deduplicationKey,
      event.summary, JSON.stringify(event.structuredData), event.confidence,
      event.privacyClass, event.trustLevel, event.correlationId || null,
      event.causationEventId || null]);
    return result.rows[0];
  }

  async getForUser({ userId, eventId }) {
    const result = await this.pool.query(`
      SELECT * FROM life_events WHERE id = $1 AND user_id = $2
    `, [eventId, userId]);
    return result.rows[0] || null;
  }

  async listForUser({ userId, beforeOccurredAt = null, beforeId = null, limit = 40 }) {
    const result = await this.pool.query(`
      SELECT * FROM life_events
      WHERE user_id = $1
        AND ($2::timestamptz IS NULL OR (occurred_at, id) < ($2::timestamptz, $3::uuid))
      ORDER BY occurred_at DESC, id DESC
      LIMIT $4
    `, [userId, beforeOccurredAt, beforeId, boundedLimit(limit)]);
    return result.rows;
  }

  async claimPending({ userId = null, limit = 20 }) {
    const claimToken = randomUUID();
    const result = await this.pool.query(`
      WITH candidates AS (
        SELECT id
        FROM life_events
        WHERE processing_state = 'pending'
          AND ($2::uuid IS NULL OR user_id = $2::uuid)
        ORDER BY recorded_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $3
      )
      UPDATE life_events AS event
      SET processing_state = 'claimed', claim_token = $1, claimed_at = now(),
          processing_attempts = processing_attempts + 1,
          processing_error_code = NULL
      FROM candidates
      WHERE event.id = candidates.id
      RETURNING event.*
    `, [claimToken, userId, boundedLimit(limit, 20, 100)]);
    return { claimToken, events: result.rows };
  }

  async markProcessed({ userId, eventId, claimToken }) {
    const result = await this.pool.query(`
      UPDATE life_events
      SET processing_state = 'processed', claim_token = NULL, claimed_at = NULL,
          processing_error_code = NULL, processed_at = now()
      WHERE id = $1 AND user_id = $2 AND processing_state = 'claimed' AND claim_token = $3
      RETURNING *
    `, [eventId, userId, claimToken]);
    return result.rows[0] || null;
  }

  async markFailed({ userId, eventId, claimToken, errorCode }) {
    if (!ERROR_CODE.test(String(errorCode || ''))) throw new Error('invalid Life OS processing error code');
    const result = await this.pool.query(`
      UPDATE life_events
      SET processing_state = CASE WHEN processing_attempts >= 3 THEN 'failed' ELSE 'pending' END,
          claim_token = NULL, claimed_at = NULL, processing_error_code = $4,
          processed_at = CASE WHEN processing_attempts >= 3 THEN now() ELSE NULL END
      WHERE id = $1 AND user_id = $2 AND processing_state = 'claimed' AND claim_token = $3
      RETURNING *
    `, [eventId, userId, claimToken, errorCode]);
    return result.rows[0] || null;
  }

  async reconcileStaleClaims({ olderThan, userId = null }) {
    const result = await this.pool.query(`
      UPDATE life_events
      SET processing_state = CASE WHEN processing_attempts >= 3 THEN 'failed' ELSE 'pending' END,
          claim_token = NULL, claimed_at = NULL,
          processing_error_code = 'STALE_CLAIM',
          processed_at = CASE WHEN processing_attempts >= 3 THEN now() ELSE NULL END
      WHERE processing_state = 'claimed' AND claimed_at < $1
        AND ($2::uuid IS NULL OR user_id = $2::uuid)
      RETURNING id, user_id, processing_state
    `, [olderThan, userId]);
    return result.rows;
  }
}

module.exports = { LifeEventRepository, boundedLimit };
