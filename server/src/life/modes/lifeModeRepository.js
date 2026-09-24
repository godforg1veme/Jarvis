const { setLifeModeSchema } = require('./lifeModeSchemas');

class LifeModeRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get({ userId }) {
    const result = await this.pool.query('SELECT * FROM life_modes WHERE user_id = $1', [userId]);
    return result.rows[0] || null;
  }

  async set({ userId, ...raw }) {
    const input = setLifeModeSchema.parse(raw);
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const result = await this.pool.query(`
      INSERT INTO life_modes (
        user_id, mode, previous_mode, source, starts_at, expires_at, transition_event_id
      )
      VALUES ($1, $2, NULL, $3, $4, $5, $6)
      ON CONFLICT (user_id) DO UPDATE SET
        mode = EXCLUDED.mode,
        previous_mode = life_modes.mode,
        source = EXCLUDED.source,
        starts_at = EXCLUDED.starts_at,
        expires_at = EXCLUDED.expires_at,
        transition_event_id = EXCLUDED.transition_event_id,
        revision = life_modes.revision + 1,
        updated_at = now()
      WHERE life_modes.revision = $7
      RETURNING *
    `, [userId, input.mode, input.source, startsAt,
      input.expiresAt ? new Date(input.expiresAt) : null,
      input.transitionEventId || null, input.revision]);
    return result.rows[0] || null;
  }

  async restoreExpired({ userId, now = new Date() }) {
    const result = await this.pool.query(`
      UPDATE life_modes SET
        mode = COALESCE(previous_mode, 'work'), previous_mode = NULL,
        source = 'manual', starts_at = $2, expires_at = NULL,
        transition_event_id = NULL, revision = revision + 1, updated_at = now()
      WHERE user_id = $1 AND expires_at IS NOT NULL AND expires_at <= $2
      RETURNING *
    `, [userId, now]);
    return result.rows[0] || null;
  }
}

module.exports = { LifeModeRepository };
