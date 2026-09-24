class ConversationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getOrCreate({ userId, channel, externalChatId }) {
    const result = await this.pool.query(`
      INSERT INTO conversations (user_id, channel, external_chat_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, channel, external_chat_id)
      DO UPDATE SET updated_at = now()
      RETURNING *
    `, [userId, channel, String(externalChatId)]);
    return result.rows[0];
  }

  async appendMessage({ userId, conversationId, role, content, contentType = 'text', externalMessageId = null }) {
    const result = await this.pool.query(`
      INSERT INTO messages (user_id, conversation_id, role, content_type, content, external_message_id)
      SELECT $1, c.id, $2, $3, $4, $5
      FROM conversations c
      WHERE c.id = $6 AND c.user_id = $1
      RETURNING *
    `, [userId, role, contentType, content, externalMessageId, conversationId]);
    if (result.rowCount !== 1) throw new Error('conversation is unavailable');
    return result.rows[0];
  }

  async recentMessages({ userId, conversationId, limit = 30 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const result = await this.pool.query(`
      SELECT id, role, content_type, content, created_at
      FROM messages
      WHERE user_id = $1 AND conversation_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `, [userId, conversationId, boundedLimit]);
    return result.rows.reverse();
  }

  async getForUser({ userId, conversationId }) {
    const result = await this.pool.query(`
      SELECT id, channel, external_chat_id, created_at, updated_at
      FROM conversations WHERE id = $1 AND user_id = $2
    `, [conversationId, userId]);
    return result.rows[0] || null;
  }
}

module.exports = { ConversationRepository };
