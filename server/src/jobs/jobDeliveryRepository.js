const { uuid, jobError } = require('./jobSchemas');

class JobDeliveryRepository {
  constructor(pool) { this.pool = pool; }
  async enqueue({ userId, vacancyId }) {
    return (await this.pool.query(`INSERT INTO job_deliveries(user_id,vacancy_id,dedup_key)
      SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM job_matches WHERE user_id=$1 AND vacancy_id=$2 AND NOT hidden)
      ON CONFLICT(user_id,dedup_key) DO NOTHING RETURNING id`,
    [uuid.parse(userId), uuid.parse(vacancyId), `card:${vacancyId}`])).rows[0] || null;
  }
  async claim() {
    // A lost Bot API response cannot be retried as if delivery definitely failed.
    await this.pool.query("UPDATE job_deliveries SET status='unknown' WHERE status='sending' AND lease_until<now()");
    return (await this.pool.query(`WITH candidate AS (SELECT d.id FROM job_deliveries d
      JOIN job_searches s ON s.user_id=d.user_id
      JOIN users u ON u.id=d.user_id AND u.role='owner'
      JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id
        AND c.channel='telegram' AND c.external_chat_id=s.chat_id
      WHERE d.status='queued' AND d.available_at<=now() AND (d.kind IN ('budget','attention') OR s.settings->>'paused'='false')
      AND (d.kind<>'card' OR EXISTS(SELECT 1 FROM job_matches m WHERE m.user_id=d.user_id AND m.vacancy_id=d.vacancy_id AND NOT m.hidden))
      ORDER BY CASE WHEN d.kind='attention' THEN 0 ELSE 1 END,d.created_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1)
      UPDATE job_deliveries d SET status='sending',lease_until=now()+interval '2 minutes',attempts=attempts+1
      FROM candidate WHERE d.id=candidate.id RETURNING d.*`)).rows[0] || null;
  }
  async enqueueAttention({ userId, incidentId }) {
    uuid.parse(userId);
    if (typeof incidentId !== 'string' || !/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(incidentId)) throw jobError('JOB_INVALID_DELIVERY_OUTCOME');
    return (await this.pool.query(`INSERT INTO job_deliveries(user_id,kind,dedup_key,payload)
      SELECT s.user_id,'attention',$2,'{"reason":"HH_CAPTCHA"}'::jsonb FROM job_searches s
      JOIN users u ON u.id=s.user_id AND u.role='owner'
      JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id
        AND c.channel='telegram' AND c.external_chat_id=s.chat_id
      WHERE s.user_id=$1 ON CONFLICT(user_id,dedup_key) DO NOTHING RETURNING id`,
    [userId, `attention:captcha:${incidentId}`])).rows[0] || null;
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
