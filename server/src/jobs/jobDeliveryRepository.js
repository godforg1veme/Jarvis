const { uuid, jobError, assertUserJobAccess } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');
const { createHash } = require('node:crypto');
const { COLLECTION_FAILURE_CODES } = require('./jobCollectionNotices');

class JobDeliveryRepository {
  constructor(pool, { accessService = null } = {}) { this.pool = pool; this.accessService = accessService; }
  async enqueue({ userId, vacancyId }) {
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      return (await client.query(`INSERT INTO job_deliveries(user_id,vacancy_id,dedup_key)
        SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM job_matches WHERE user_id=$1 AND vacancy_id=$2 AND NOT hidden)
        ON CONFLICT(user_id,dedup_key) DO NOTHING RETURNING id`,
      [uuid.parse(userId), uuid.parse(vacancyId), `card:${vacancyId}`])).rows[0] || null;
    });
  }
  async claim() {
    // A lost Bot API response cannot be retried as if delivery definitely failed.
    return jobTransaction(this.pool, async (client) => {
      await client.query("UPDATE job_deliveries SET status='unknown' WHERE status='sending' AND lease_until<now()");
      const candidates = (await client.query(`SELECT d.* FROM job_deliveries d
        JOIN job_searches s ON s.user_id=d.user_id
        JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id
          AND c.channel='telegram' AND c.external_chat_id=s.chat_id
        JOIN user_identities i ON i.user_id=d.user_id AND i.provider='telegram' AND i.external_id=s.chat_id
        WHERE d.status='queued' AND d.available_at<=now() AND (d.kind IN ('budget','attention') OR s.settings->>'paused'='false')
        AND (d.kind<>'card' OR EXISTS(SELECT 1 FROM job_matches m WHERE m.user_id=d.user_id AND m.vacancy_id=d.vacancy_id AND NOT m.hidden))
        ORDER BY CASE WHEN d.kind='attention' THEN 0 ELSE 1 END,d.created_at,d.id
        FOR UPDATE OF d SKIP LOCKED LIMIT 50`)).rows;
      for (const candidate of candidates) {
        try { await assertUserJobAccess(client, this.accessService, candidate.user_id); }
        catch {
          await client.query("UPDATE job_deliveries SET status='failed',lease_until=NULL WHERE id=$1 AND status='queued'", [candidate.id]);
          continue;
        }
        return (await client.query(`UPDATE job_deliveries SET status='sending',lease_until=now()+interval '2 minutes',attempts=attempts+1
          WHERE id=$1 AND status='queued' RETURNING *`, [candidate.id])).rows[0] || null;
      }
      return null;
    });
  }
  async enqueueAttention({ userId, incidentId }) {
    uuid.parse(userId);
    if (typeof incidentId !== 'string' || !/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(incidentId)) throw jobError('JOB_INVALID_DELIVERY_OUTCOME');
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      return (await client.query(`INSERT INTO job_deliveries(user_id,kind,dedup_key,payload)
      SELECT s.user_id,'attention',$2,'{"reason":"HH_CAPTCHA"}'::jsonb FROM job_searches s
      JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id
        AND c.channel='telegram' AND c.external_chat_id=s.chat_id
      WHERE s.user_id=$1 ON CONFLICT(user_id,dedup_key) DO NOTHING RETURNING id`,
      [userId, `attention:captcha:${incidentId}`])).rows[0] || null;
    });
  }
  async enqueueCollectionAttention({ userId, runUntil, code }) {
    uuid.parse(userId);
    if (typeof runUntil !== 'string' || runUntil.length > 40 || !Number.isFinite(Date.parse(runUntil))
      || new Date(runUntil).toISOString() !== runUntil || !COLLECTION_FAILURE_CODES.has(code)) throw jobError('JOB_INVALID_DELIVERY_OUTCOME');
    const key = `attention:collection:${createHash('sha256').update(JSON.stringify([userId, runUntil])).digest('hex')}`;
    return jobTransaction(this.pool, async client => {
      await assertUserJobAccess(client, this.accessService, userId);
      return (await client.query(`INSERT INTO job_deliveries(user_id,kind,dedup_key,payload)
        SELECT s.user_id,'attention',$3,jsonb_build_object('reason','HH_COLLECTION_STATUS','code','INCOMPLETE',
          'conversationId',s.conversation_id::text,'chatId',s.chat_id,'runUntil',$2::text)
        FROM job_searches s JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id
          AND c.channel='telegram' AND c.external_chat_id=s.chat_id
        JOIN user_identities i ON i.user_id=s.user_id AND i.provider='telegram' AND i.external_id=s.chat_id
        WHERE s.user_id=$1 AND s.settings->>'activated'='true' AND s.settings->>'paused'='false'
          AND s.progress->>'until'=$2
        ON CONFLICT(user_id,dedup_key) DO NOTHING RETURNING id`, [userId, runUntil, key])).rows[0] || null;
    });
  }
  async finish({ deliveryId, outcome, telegramMessageId = null, retryAfterMs = 30000 }) {
    if (!['sent', 'failed', 'unknown', 'queued'].includes(outcome)) throw jobError('JOB_INVALID_DELIVERY_OUTCOME');
    if (!Number.isInteger(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 86400000) throw jobError('JOB_INVALID_RETRY');
    return (await this.pool.query(`UPDATE job_deliveries SET status=$1,telegram_message_id=$2,lease_until=NULL,
      available_at=now()+($3::int*interval '1 millisecond') WHERE id=$4 AND status='sending' RETURNING id`,
    [outcome, telegramMessageId == null ? null : String(telegramMessageId), retryAfterMs, uuid.parse(deliveryId)])).rowCount === 1;
  }
}

module.exports = { JobDeliveryRepository };
