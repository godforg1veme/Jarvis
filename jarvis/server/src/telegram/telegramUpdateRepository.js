class TelegramUpdateRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async claim(updateId, telegramUserId, updateKind) {
    const kind = String(updateKind || '');
    if (!['message', 'callback'].includes(kind)) throw new Error('invalid Telegram update kind');
    const result = await this.pool.query(`
      INSERT INTO telegram_updates (update_id, telegram_user_id, update_kind, status)
      VALUES ($1, $2, $3, 'processing')
      ON CONFLICT (update_id) DO NOTHING
      RETURNING update_id
    `, [updateId, String(telegramUserId), kind]);
    return result.rowCount === 1;
  }

  async markCompleted(updateId) {
    await this.pool.query(`
      UPDATE telegram_updates
      SET status='completed', completed_at=now(), failed_at=NULL, failure_code=NULL
      WHERE update_id=$1
    `, [updateId]);
  }

  async markFailed(updateId, failureCode) {
    const code = String(failureCode || 'DIALOGUE_UNAVAILABLE');
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) throw new Error('invalid Telegram failure code');
    await this.pool.query(`
      UPDATE telegram_updates
      SET status='failed', failed_at=now(), failure_code=$2
      WHERE update_id=$1
    `, [updateId, code]);
  }
}

module.exports = { TelegramUpdateRepository };
