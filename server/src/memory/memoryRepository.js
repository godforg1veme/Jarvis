class MemoryRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listActive({ userId, limit = 30 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const result = await this.pool.query(`
      SELECT id, kind, content, source_conversation_id, created_at, updated_at
      FROM memories
      WHERE user_id = $1 AND active = true
      ORDER BY updated_at DESC, id DESC
      LIMIT $2
    `, [userId, boundedLimit]);
    return result.rows;
  }

  async create({ userId, kind, content, sourceConversationId = null, changeReason = '' }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`
        INSERT INTO memories (user_id, kind, content, source_conversation_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, kind, content, source_conversation_id, created_at, updated_at
      `, [userId, kind, content, sourceConversationId]);
      const memory = inserted.rows[0];
      await client.query(`
        INSERT INTO memory_versions (user_id, memory_id, content, change_reason)
        VALUES ($1, $2, $3, $4)
      `, [userId, memory.id, memory.content, changeReason]);
      await client.query('COMMIT');
      return memory;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivateMatching({ userId, query, changeReason = '' }) {
    const result = await this.pool.query(`
      UPDATE memories
      SET active = false, updated_at = now()
      WHERE user_id = $1
        AND active = true
        AND content ILIKE ('%' || $2 || '%')
      RETURNING id, content
    `, [userId, query]);
    for (const memory of result.rows) {
      await this.pool.query(`
        INSERT INTO memory_versions (user_id, memory_id, content, change_reason)
        VALUES ($1, $2, $3, $4)
      `, [userId, memory.id, memory.content, changeReason]);
    }
    return result.rows;
  }

  async deactivateById({ userId, memoryId, changeReason = '' }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        UPDATE memories SET active=false,updated_at=now()
        WHERE id=$1 AND user_id=$2 AND active=true
        RETURNING id,content
      `, [memoryId, userId]);
      const memory = result.rows[0] || null;
      if (memory) await client.query(`
        INSERT INTO memory_versions (user_id,memory_id,content,change_reason)
        VALUES ($1,$2,$3,$4)
      `, [userId, memory.id, memory.content, changeReason]);
      await client.query('COMMIT');
      return memory;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceById({ userId, memoryId, kind, content, sourceConversationId = null, changeReason = '' }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query(`
        UPDATE memories SET active=false,updated_at=now()
        WHERE id=$1 AND user_id=$2 AND active=true
        RETURNING id,content
      `, [memoryId, userId]);
      if (!previous.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(`
        INSERT INTO memory_versions (user_id,memory_id,content,change_reason)
        VALUES ($1,$2,$3,$4)
      `, [userId, memoryId, previous.rows[0].content, changeReason]);
      const inserted = await client.query(`
        INSERT INTO memories (user_id,kind,content,source_conversation_id)
        VALUES ($1,$2,$3,$4)
        RETURNING id,kind,content,source_conversation_id,created_at,updated_at
      `, [userId, kind, content, sourceConversationId]);
      await client.query(`
        INSERT INTO memory_versions (user_id,memory_id,content,change_reason)
        VALUES ($1,$2,$3,$4)
      `, [userId, inserted.rows[0].id, content, changeReason]);
      await client.query('COMMIT');
      return inserted.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { MemoryRepository };
