const { assertJobScope } = require('./jobSchemas');
const { randomUUID } = require('node:crypto');
class JobCaptchaRepository {
  constructor(pool) { this.pool = pool; }
  async scope(userId) {
    return (await this.pool.query(`SELECT s.user_id AS "userId",s.conversation_id AS "conversationId",s.chat_id AS "chatId",'telegram' AS channel
      FROM job_searches s JOIN users u ON u.id=s.user_id AND u.role='owner'
      JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id AND c.channel='telegram' AND c.external_chat_id=s.chat_id
      JOIN user_identities ti ON ti.user_id=u.id AND ti.provider='telegram' AND ti.external_id=s.chat_id WHERE s.user_id=$1`, [userId])).rows[0] || null;
  }
  async request(scope, refresh) {
    await assertJobScope(this.pool, scope);
    await this.pool.query(`WITH retired AS (
      UPDATE job_captcha_photos SET superseded=true
      WHERE user_id=$1 AND conversation_id=$3 AND chat_id=$4 AND $2::boolean AND status IN ('sending','unknown')
      RETURNING id)
      INSERT INTO job_captcha_controls(user_id,refresh_requested) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET refresh_requested=job_captcha_controls.refresh_requested OR excluded.refresh_requested`,
    [scope.userId,refresh,scope.conversationId,scope.chatId]);
  }
  async consumeRefresh(scope) {
    await assertJobScope(this.pool, scope);
    return (await this.pool.query('DELETE FROM job_captcha_controls WHERE user_id=$1 RETURNING refresh_requested', [scope.userId])).rows[0]?.refresh_requested === true;
  }
  async hasUnknownDelivery(scope) {
    await assertJobScope(this.pool, scope);
    return (await this.pool.query("SELECT 1 FROM job_captcha_photos WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND NOT superseded AND status IN ('sending','unknown') LIMIT 1", [scope.userId,scope.conversationId,scope.chatId])).rowCount > 0;
  }
  async enqueue(scope, challenge) {
    await assertJobScope(this.pool, scope);
    await this.pool.query(`UPDATE job_captcha_photos SET status='stale' WHERE user_id=$1 AND challenge_id<>$2 AND status IN ('queued','sent')`, [scope.userId, challenge.challengeId]);
    return (await this.pool.query(`INSERT INTO job_captcha_photos(user_id,conversation_id,chat_id,challenge_id,revision,expires_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,challenge_id) DO NOTHING RETURNING id`,
    [scope.userId,scope.conversationId,scope.chatId,challenge.challengeId,challenge.revision,challenge.expiresAt])).rows[0];
  }
  async claim(scope, challengeId) {
    await assertJobScope(this.pool, scope);
    await this.pool.query("UPDATE job_captcha_photos SET status='unknown',lease_until=NULL WHERE user_id=$1 AND status='sending' AND lease_until<now()", [scope.userId]);
    return (await this.pool.query(`UPDATE job_captcha_photos SET status='sending',lease_until=now()+interval '2 minutes'
      WHERE user_id=$1 AND challenge_id=$2 AND conversation_id=$3 AND chat_id=$4 AND status='queued' AND expires_at>now() RETURNING *`,
    [scope.userId,challengeId,scope.conversationId,scope.chatId])).rows[0];
  }
  async delivered(scope, id, messageId, outcome) {
    await assertJobScope(this.pool, scope);
    await this.pool.query(`UPDATE job_captcha_photos SET status=$2,telegram_message_id=$3,lease_until=NULL
      WHERE id=$1 AND status='sending' AND user_id=$4 AND conversation_id=$5 AND chat_id=$6`,
    [id,outcome,messageId == null ? null : String(messageId),scope.userId,scope.conversationId,scope.chatId]);
  }
  async known(scope, messageId) {
    await assertJobScope(this.pool, scope);
    return (await this.pool.query('SELECT status,expires_at FROM job_captcha_photos WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND telegram_message_id=$4',
    [scope.userId,scope.conversationId,scope.chatId,messageId])).rows[0] || null;
  }
  async consume(scope, messageId) {
    await assertJobScope(this.pool, scope);
    return (await this.pool.query(`UPDATE job_captcha_photos SET status='consumed',operation_id=$5,outcome='unknown'
      WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3 AND telegram_message_id=$4 AND status='sent' AND expires_at>now()
      AND NOT EXISTS(SELECT 1 FROM job_captcha_photos newer WHERE newer.user_id=$1 AND newer.created_at>job_captcha_photos.created_at)
      RETURNING challenge_id,revision,operation_id`, [scope.userId,scope.conversationId,scope.chatId,messageId,randomUUID()])).rows[0];
  }
  async finish(scope, operationId, outcome) {
    await assertJobScope(this.pool, scope);
    await this.pool.query("UPDATE job_captcha_photos SET outcome=$3 WHERE user_id=$1 AND operation_id=$2 AND status='consumed'", [scope.userId,operationId,outcome]);
  }
}
module.exports = { JobCaptchaRepository };
