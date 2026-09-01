class UserRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByIdentity(provider, externalId) {
    const result = await this.pool.query(`
      SELECT u.id, u.display_name, u.role, u.created_at, u.updated_at
      FROM users u
      JOIN user_identities i ON i.user_id = u.id
      WHERE i.provider = $1 AND i.external_id = $2
    `, [provider, String(externalId)]);
    return result.rows[0] || null;
  }

  async findOrCreateTelegramUser({ telegramUserId, displayName, role = 'member' }) {
    const externalId = String(telegramUserId);
    const name = String(displayName || `Telegram ${externalId}`).trim().slice(0, 100);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`
        SELECT u.id, u.display_name, u.role, u.created_at, u.updated_at
        FROM users u
        JOIN user_identities i ON i.user_id = u.id
        WHERE i.provider = $1 AND i.external_id = $2
        FOR UPDATE OF i
      `, ['telegram', externalId]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return existing.rows[0];
      }

      const inserted = await client.query(`
        WITH new_user AS (
          INSERT INTO users (display_name, role)
          VALUES ($1, $2)
          RETURNING *
        ), new_identity AS (
          INSERT INTO user_identities (user_id, provider, external_id)
          SELECT id, 'telegram', $3 FROM new_user
        )
        SELECT id, display_name, role, created_at, updated_at FROM new_user
      `, [name, role, externalId]);
      await client.query('COMMIT');
      return inserted.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && error.code === '23505') return this.findByIdentity('telegram', externalId);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { UserRepository };
