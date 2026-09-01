class DesktopRequestRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async claim({ userId, deviceId, clientMessageId, kind }) {
    const inserted = await this.pool.query(`
      INSERT INTO desktop_requests (user_id, device_id, client_message_id, kind)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (device_id, client_message_id) DO NOTHING
      RETURNING id, user_id, device_id, client_message_id, conversation_id, kind, status, response, error_code
    `, [userId, deviceId, clientMessageId, kind]);
    if (inserted.rowCount === 1) return { created: true, request: inserted.rows[0] };

    const existing = await this.pool.query(`
      SELECT id, user_id, device_id, client_message_id, conversation_id, kind, status, response, error_code
      FROM desktop_requests
      WHERE user_id = $1 AND device_id = $2 AND client_message_id = $3
    `, [userId, deviceId, clientMessageId]);
    return { created: false, request: existing.rows[0] || null };
  }

  async complete({ userId, deviceId, clientMessageId, conversationId, response }) {
    const result = await this.pool.query(`
      UPDATE desktop_requests
      SET status = 'completed', conversation_id = $4, response = $5, error_code = NULL, updated_at = now()
      WHERE user_id = $1 AND device_id = $2 AND client_message_id = $3 AND status = 'processing'
      RETURNING *
    `, [userId, deviceId, clientMessageId, conversationId, response]);
    if (result.rowCount !== 1) throw new Error('desktop request completion failed');
    return result.rows[0];
  }

  async fail({ userId, deviceId, clientMessageId, errorCode }) {
    await this.pool.query(`
      UPDATE desktop_requests
      SET status = 'failed', error_code = $4, updated_at = now()
      WHERE user_id = $1 AND device_id = $2 AND client_message_id = $3 AND status = 'processing'
    `, [userId, deviceId, clientMessageId, errorCode]);
  }
}

module.exports = { DesktopRequestRepository };
