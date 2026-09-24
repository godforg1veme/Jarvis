function mapSubscriptionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    user_id: row.user_id ?? row.userId,
    label: row.label,
    tokenHash: row.token_hash ?? row.tokenHash,
    token_hash: row.token_hash ?? row.tokenHash,
    clientIdDe: row.client_id_de ?? row.clientIdDe ?? null,
    client_id_de: row.client_id_de ?? row.clientIdDe ?? null,
    clientIdNl: row.client_id_nl ?? row.clientIdNl ?? null,
    client_id_nl: row.client_id_nl ?? row.clientIdNl ?? null,
    createdAt: row.created_at ?? row.createdAt,
    created_at: row.created_at ?? row.createdAt,
    revokedAt: row.revoked_at ?? row.revokedAt ?? null,
    revoked_at: row.revoked_at ?? row.revokedAt ?? null,
    lastAccessedAt: row.last_accessed_at ?? row.lastAccessedAt ?? null,
    last_accessed_at: row.last_accessed_at ?? row.lastAccessedAt ?? null,
    createdBy: row.created_by ?? row.createdBy,
    created_by: row.created_by ?? row.createdBy,
  };
}

class VpnSubscriptionRepository {
  constructor(options = {}) {
    const pool = options?.pool || options;
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('VpnSubscriptionRepository requires a database pool with a query method');
    }
    this.pool = pool;
  }

  async create({ userId, label, tokenHash, clientIdDe = null, clientIdNl = null, createdBy }) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new Error('userId must be a non-empty string');
    }
    if (!label || typeof label !== 'string' || !label.trim()) {
      throw new Error('label must be a non-empty string');
    }
    if (!tokenHash || typeof tokenHash !== 'string' || !tokenHash.trim()) {
      throw new Error('tokenHash must be a non-empty string');
    }
    if (!createdBy || typeof createdBy !== 'string' || !createdBy.trim()) {
      throw new Error('createdBy must be a non-empty string');
    }

    const result = await this.pool.query(`
      INSERT INTO vpn_subscriptions (
        user_id, label, token_hash, client_id_de, client_id_nl, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      userId.trim(),
      label.trim(),
      tokenHash.trim(),
      clientIdDe ? String(clientIdDe).trim() : null,
      clientIdNl ? String(clientIdNl).trim() : null,
      createdBy.trim(),
    ]);

    return mapSubscriptionRow(result.rows[0]);
  }

  async findActiveByTokenHash(tokenHash) {
    if (!tokenHash || typeof tokenHash !== 'string' || !tokenHash.trim()) {
      return null;
    }

    const result = await this.pool.query(`
      SELECT * FROM vpn_subscriptions
      WHERE token_hash = $1 AND revoked_at IS NULL
      LIMIT 1
    `, [tokenHash.trim()]);

    return mapSubscriptionRow(result.rows[0] || null);
  }

  async findById(id) {
    if (!id || typeof id !== 'string' || !id.trim()) {
      return null;
    }

    const result = await this.pool.query(`
      SELECT * FROM vpn_subscriptions
      WHERE id = $1
      LIMIT 1
    `, [id.trim()]);

    return mapSubscriptionRow(result.rows[0] || null);
  }

  async listByUser(userId, options = {}) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return [];
    }

    const activeOnly = Boolean(options?.activeOnly);
    const sql = activeOnly
      ? `
        SELECT * FROM vpn_subscriptions
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC
      `
      : `
        SELECT * FROM vpn_subscriptions
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;

    const result = await this.pool.query(sql, [userId.trim()]);
    return (result.rows || []).map(mapSubscriptionRow);
  }

  async touchLastAccessed(id) {
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new Error('Subscription id is required');
    }

    await this.pool.query(`
      UPDATE vpn_subscriptions
      SET last_accessed_at = NOW()
      WHERE id = $1
    `, [id.trim()]);
  }

  async bindClients({ id, userId, clientIdDe, clientIdNl }) {
    if (!id || !userId || !clientIdDe || !clientIdNl) throw new Error('Subscription client binding is required');
    const result = await this.pool.query(`
      UPDATE vpn_subscriptions SET client_id_de=$1, client_id_nl=$2
      WHERE id=$3 AND user_id=$4 AND revoked_at IS NULL
        AND client_id_de IS NULL AND client_id_nl IS NULL RETURNING *
    `, [JSON.stringify(clientIdDe), JSON.stringify(clientIdNl), id, userId]);
    return mapSubscriptionRow(result.rows?.[0] || null);
  }

  async rename({ id, userId, label }) {
    if (!id || typeof id !== 'string' || !id.trim()) throw new Error('Subscription id is required');
    if (!userId || typeof userId !== 'string' || !userId.trim()) throw new Error('userId is required');
    if (!label || typeof label !== 'string' || !label.trim()) throw new Error('label is required');
    const result = await this.pool.query(`
      UPDATE vpn_subscriptions SET label = $1
      WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
      RETURNING *
    `, [label.trim(), id.trim(), userId.trim()]);
    return mapSubscriptionRow(result.rows?.[0] || null);
  }

  async rotate({ id, userId = null, tokenHash }) {
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new Error('Subscription id is required');
    }
    if (!tokenHash || typeof tokenHash !== 'string' || !tokenHash.trim()) {
      throw new Error('tokenHash is required');
    }

    const sql = userId
      ? `
        UPDATE vpn_subscriptions
        SET token_hash = $1
        WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
        RETURNING *
      `
      : `
        UPDATE vpn_subscriptions
        SET token_hash = $1
        WHERE id = $2 AND revoked_at IS NULL
        RETURNING *
      `;

    const params = userId ? [tokenHash.trim(), id.trim(), String(userId).trim()] : [tokenHash.trim(), id.trim()];
    const result = await this.pool.query(sql, params);
    return mapSubscriptionRow(result.rows?.[0] || null);
  }

  async revoke({ id, userId = null }) {
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new Error('Subscription id is required');
    }

    const sql = userId
      ? `
        UPDATE vpn_subscriptions
        SET revoked_at = NOW()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING id
      `
      : `
        UPDATE vpn_subscriptions
        SET revoked_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING id
      `;

    const params = userId ? [id.trim(), String(userId).trim()] : [id.trim()];
    const result = await this.pool.query(sql, params);
    const count = result.rowCount != null ? result.rowCount : (result.rows?.length || 0);
    return count > 0;
  }
}

module.exports = {
  VpnSubscriptionRepository,
  mapSubscriptionRow,
};
