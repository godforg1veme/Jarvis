const { assertJobScope, assertUserJobAccess } = require('./jobSchemas');
const { randomUUID } = require('node:crypto');
const { captchaNoticeView } = require('./jobCaptchaNotices');
class JobCaptchaRepository {
  constructor(pool, { accessService = null } = {}) { this.pool = pool; this.accessService = accessService; }
  async activeUsers() {
    const candidates = (await this.pool.query(`SELECT s.user_id FROM job_searches s
      JOIN job_connections c ON c.user_id=s.user_id AND c.status='connected'
      WHERE s.settings->>'activated'='true' AND s.settings->>'paused'='false'
      ORDER BY s.updated_at,s.user_id LIMIT 100`)).rows;
    const allowed = [];
    for (const row of candidates) {
      try { await assertUserJobAccess(this.pool, this.accessService, row.user_id); allowed.push(row.user_id); }
      catch { /* Revoked users have no CAPTCHA work. */ }
    }
    return allowed;
  }
  async scope(userId) {
    await assertUserJobAccess(this.pool, this.accessService, userId);
    return (await this.pool.query(`SELECT s.user_id AS "userId",s.conversation_id AS "conversationId",s.chat_id AS "chatId",'telegram' AS channel
      FROM job_searches s
      JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id AND c.channel='telegram' AND c.external_chat_id=s.chat_id
      JOIN user_identities ti ON ti.user_id=s.user_id AND ti.provider='telegram' AND ti.external_id=s.chat_id WHERE s.user_id=$1`, [userId])).rows[0] || null;
  }
  async request(scope, refresh) {
    await assertJobScope(this.pool, scope, this.accessService);
    await this.pool.query(`WITH retired AS (
      UPDATE job_captcha_photos SET superseded=true,
        status=CASE WHEN status IN ('queued','sent') THEN 'stale' ELSE status END
      WHERE user_id=$1 AND conversation_id=$3 AND chat_id=$4 AND $2::boolean
      RETURNING id), retired_notices AS (
      UPDATE job_deliveries SET status='failed' WHERE user_id=$1 AND $2::boolean AND status='queued'
        AND payload->>'reason'='HH_CAPTCHA_STATUS' AND payload->>'conversationId'=$3::text AND payload->>'chatId'=$4
      RETURNING id)
      INSERT INTO job_captcha_controls(user_id,refresh_requested) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET refresh_requested=job_captcha_controls.refresh_requested OR excluded.refresh_requested,
        request_id=excluded.request_id,requested_at=now(),explicit_request=true`,
    [scope.userId,refresh,scope.conversationId,scope.chatId]);
  }
  async getRequest(scope) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query('SELECT request_id,refresh_requested,explicit_request FROM job_captcha_controls WHERE user_id=$1', [scope.userId])).rows[0] || null;
  }
  async ensureRequest(scope) {
    await assertJobScope(this.pool, scope, this.accessService);
    await this.pool.query('INSERT INTO job_captcha_controls(user_id,explicit_request) VALUES($1,false) ON CONFLICT(user_id) DO NOTHING', [scope.userId]);
    return this.getRequest(scope);
  }
  async ackRequest(scope, requestId) {
    await assertJobScope(this.pool, scope, this.accessService);
    await this.pool.query(`WITH retired AS (
      UPDATE job_deliveries SET status='failed' WHERE user_id=$1 AND status='queued'
        AND payload->>'reason'='HH_CAPTCHA_STATUS' AND payload->>'code'='PREPARATION_DELAYED'
        AND payload->>'requestId'=$2::text AND payload->>'conversationId'=$3::text AND payload->>'chatId'=$4
      RETURNING id)
      DELETE FROM job_captcha_controls WHERE user_id=$1 AND request_id=$2::uuid`, [scope.userId, requestId,scope.conversationId,scope.chatId]);
  }
  async recover(scope) {
    await assertJobScope(this.pool, scope, this.accessService);
    await this.pool.query(`UPDATE job_captcha_photos SET status=CASE WHEN status='sending' THEN 'unknown' ELSE 'stale' END,lease_until=NULL
      WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND
      (status='sending' AND lease_until<now() OR status IN ('queued','sent') AND expires_at<=now())`, [scope.userId,scope.conversationId,scope.chatId]);
  }
  async hasUnknownDelivery(scope) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query(`SELECT CASE WHEN status='sending' THEN 'sending'
      WHEN status='consumed' AND lease_until>now() THEN 'answer_sending'
      WHEN status='consumed' THEN 'answer_unknown' ELSE 'unknown' END AS reason
      FROM job_captcha_photos WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND NOT superseded
      AND (status IN ('sending','unknown') OR status='consumed' AND outcome='unknown') LIMIT 1`, [scope.userId,scope.conversationId,scope.chatId])).rows[0]?.reason || null;
  }
  async enqueue(scope, challenge) {
    await assertJobScope(this.pool, scope, this.accessService);
    await this.pool.query(`UPDATE job_captcha_photos SET status='stale' WHERE user_id=$1 AND challenge_id<>$2 AND status IN ('queued','sent')`, [scope.userId, challenge.challengeId]);
    return (await this.pool.query(`INSERT INTO job_captcha_photos(user_id,conversation_id,chat_id,challenge_id,revision,expires_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,challenge_id) DO NOTHING RETURNING id`,
    [scope.userId,scope.conversationId,scope.chatId,challenge.challengeId,challenge.revision,challenge.expiresAt])).rows[0];
  }
  async claim(scope, challengeId, requestId = null) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query(`UPDATE job_captcha_photos SET status='sending',lease_until=now()+interval '2 minutes',attempts=attempts+1
      WHERE user_id=$1 AND challenge_id=$2 AND conversation_id=$3 AND chat_id=$4 AND status='queued' AND NOT superseded
      AND expires_at>now() AND available_at<=now() AND attempts<4
      AND NOT EXISTS(SELECT 1 FROM job_captcha_controls WHERE user_id=$1 AND request_id IS DISTINCT FROM $5::uuid) RETURNING *`,
    [scope.userId,challengeId,scope.conversationId,scope.chatId,requestId])).rows[0];
  }
  async delivered(scope, id, messageId, outcome, retryAfterMs = 0) {
    await assertJobScope(this.pool, scope, this.accessService);
    if (!['sent','failed','unknown','queued'].includes(outcome) || !Number.isInteger(retryAfterMs) || retryAfterMs<0 || retryAfterMs>86400000) throw new Error('JOB_INVALID_DELIVERY_OUTCOME');
    await this.pool.query(`UPDATE job_captcha_photos SET status=$2,telegram_message_id=$3,lease_until=NULL
      ,available_at=now()+($7::int*interval '1 millisecond')
      WHERE id=$1 AND status='sending' AND user_id=$4 AND conversation_id=$5 AND chat_id=$6`,
    [id,outcome,messageId == null ? null : String(messageId),scope.userId,scope.conversationId,scope.chatId,retryAfterMs]);
  }
  async notify(scope, code, requestId = null) {
    await assertJobScope(this.pool, scope, this.accessService);
    if (!captchaNoticeView(code)) throw new Error('JOB_INVALID_DELIVERY_OUTCOME');
    await this.pool.query(`INSERT INTO job_deliveries(user_id,kind,dedup_key,payload)
      VALUES($1,'attention','attention:captcha-status:'||$4||':'||COALESCE($5::text,
        (SELECT id::text FROM job_captcha_photos WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1),'initial'),
        jsonb_build_object('reason','HH_CAPTCHA_STATUS','code',$4::text,'conversationId',$2::text,'chatId',$3::text,'requestId',$5::text))
      ON CONFLICT(user_id,dedup_key) DO NOTHING`, [scope.userId,scope.conversationId,scope.chatId,code,requestId]);
  }
  async photoState(scope, challengeId) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query('SELECT status FROM job_captcha_photos WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND challenge_id=$4',
      [scope.userId,scope.conversationId,scope.chatId,challengeId])).rows[0]?.status;
  }
  async known(scope, messageId) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query('SELECT status,expires_at FROM job_captcha_photos WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND telegram_message_id=$4',
    [scope.userId,scope.conversationId,scope.chatId,messageId])).rows[0] || null;
  }
  async consume(scope, messageId) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query(`UPDATE job_captcha_photos SET status='consumed',operation_id=$5,outcome='unknown',lease_until=now()+interval '2 minutes'
      WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND telegram_message_id=$4 AND status='sent' AND NOT superseded AND expires_at>now()
      AND NOT EXISTS(SELECT 1 FROM job_captcha_photos newer WHERE newer.user_id=$1 AND newer.created_at>job_captcha_photos.created_at)
      RETURNING challenge_id,revision,operation_id`, [scope.userId,scope.conversationId,scope.chatId,messageId,randomUUID()])).rows[0];
  }
  async finish(scope, operationId, outcome) {
    await assertJobScope(this.pool, scope, this.accessService);
    await this.pool.query("UPDATE job_captcha_photos SET outcome=$3,lease_until=NULL WHERE user_id=$1 AND conversation_id=$4 AND chat_id=$5 AND operation_id=$2 AND status='consumed'", [scope.userId,operationId,outcome,scope.conversationId,scope.chatId]);
  }
}
module.exports = { JobCaptchaRepository };
