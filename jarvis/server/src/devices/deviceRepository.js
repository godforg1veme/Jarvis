const {
  createDeviceToken,
  deviceTokenHash,
  pairingCodeHash,
} = require('./deviceCredentials');

class DeviceRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createPairingCode({ userId, code, deviceName, expiresAt }) {
    const result = await this.pool.query(`
      INSERT INTO device_pairing_codes (user_id, code_hash, device_name, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id, expires_at
    `, [userId, pairingCodeHash(code), deviceName, expiresAt]);
    return result.rows[0];
  }

  async claimPairingCode({ code, capabilities = {} }) {
    const token = createDeviceToken();
    const result = await this.pool.query(`
      WITH consumed_code AS (
        UPDATE device_pairing_codes
        SET consumed_at = now()
        WHERE code_hash = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING user_id, device_name
      ), created_device AS (
        INSERT INTO devices (user_id, name, token_hash, capabilities, status, last_seen_at)
        SELECT user_id, device_name, $2, $3, 'offline', now()
        FROM consumed_code
        RETURNING id, user_id, name, status, capabilities, created_at, updated_at
      )
      SELECT * FROM created_device
    `, [pairingCodeHash(code), deviceTokenHash(token), capabilities]);
    if (result.rowCount !== 1) return null;
    return { ...result.rows[0], token };
  }

  async findActiveByToken(token) {
    const result = await this.pool.query(`
      SELECT id, user_id, name, status, capabilities, last_seen_at, created_at, updated_at
      FROM devices
      WHERE token_hash = $1 AND status <> 'revoked'
    `, [deviceTokenHash(token)]);
    return result.rows[0] || null;
  }

  async listForUser(userId) {
    const result = await this.pool.query(`
      SELECT id, name, status, capabilities, last_seen_at, created_at, updated_at
      FROM devices
      WHERE user_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 50
    `, [userId]);
    return result.rows;
  }

  async markOnline({ userId, deviceId }) {
    const result = await this.pool.query(`
      UPDATE devices
      SET status = 'online', last_seen_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status <> 'revoked'
      RETURNING id, user_id, name, status, capabilities, last_seen_at
    `, [deviceId, userId]);
    return result.rows[0] || null;
  }

  async markOffline({ userId, deviceId }) {
    const result = await this.pool.query(`
      UPDATE devices
      SET status = 'offline', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'online'
      RETURNING id, user_id, name, status, capabilities, last_seen_at
    `, [deviceId, userId]);
    return result.rows[0] || null;
  }

  async setCapabilities({ userId, deviceId, capabilities }) {
    const result = await this.pool.query(`
      UPDATE devices
      SET capabilities = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status <> 'revoked'
      RETURNING id, user_id, name, status, capabilities, last_seen_at
    `, [deviceId, userId, capabilities]);
    return result.rows[0] || null;
  }

  async revokeForUser({ userId, deviceId }) {
    const result = await this.pool.query(`
      UPDATE devices
      SET status = 'revoked', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status <> 'revoked'
      RETURNING id, name, status
    `, [deviceId, userId]);
    return result.rows[0] || null;
  }
}

module.exports = { DeviceRepository };
