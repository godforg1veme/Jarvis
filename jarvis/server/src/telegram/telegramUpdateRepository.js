class TelegramUpdateRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async claim(updateId, telegramUserId) {
    const result = await this.pool.query(`
      INSERT INTO telegram_updates (update_id, telegram_user_id)
      VALUES ($1, $2)
      ON CONFLICT (update_id) DO NOTHING
      RETURNING update_id
    `, [updateId, String(telegramUserId)]);
    return result.rowCount === 1;
  }
}

module.exports = { TelegramUpdateRepository };
