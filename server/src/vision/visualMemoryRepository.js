class VisualMemoryRepository {
  constructor(pool) { this.pool = pool; }

  async create(input) {
    const result = await this.pool.query(`
      INSERT INTO visual_memories
        (user_id, device_id, lease_id, frame_id, source_id, state, sensitivity, blob_key,
         byte_length, content_hash, confidence, captured_at, expires_at, pending_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [input.userId, input.deviceId, input.leaseId, input.frameId, input.sourceId, input.state,
      input.sensitivity, input.blobKey, input.byteLength, input.contentHash, input.confidence,
      input.capturedAt, input.expiresAt, input.pendingExpiresAt]);
    return result.rows[0];
  }

  async addTokens({ memoryId, userId, tokenHashes }) {
    for (const hash of tokenHashes) {
      await this.pool.query(`INSERT INTO visual_memory_tokens (memory_id, user_id, token_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [memoryId, userId, hash]);
    }
  }

  async list({ userId, limit = 50, sourceId = '' }) {
    const result = await this.pool.query(`
      SELECT id, frame_id, source_id, state, sensitivity, byte_length, confidence,
             captured_at, expires_at, pinned, corrected_summary, created_at
      FROM visual_memories
      WHERE user_id = $1 AND state NOT IN ('deleted','expired','rejected')
        AND ($2 = '' OR source_id = $2)
      ORDER BY captured_at DESC LIMIT $3
    `, [userId, sourceId, Math.min(Math.max(Number(limit) || 50, 1), 100)]);
    return result.rows;
  }

  async get({ userId, memoryId }) {
    const result = await this.pool.query('SELECT * FROM visual_memories WHERE user_id=$1 AND id=$2', [userId, memoryId]);
    return result.rows[0] || null;
  }

  async searchByTokens({ userId, tokenHashes, limit = 5 }) {
    if (!tokenHashes.length) return [];
    const result = await this.pool.query(`
      SELECT m.*, count(t.token_hash)::int AS token_matches
      FROM visual_memories m
      JOIN visual_memory_tokens t ON t.memory_id=m.id AND t.user_id=m.user_id
      WHERE m.user_id=$1 AND m.state='stored' AND t.token_hash=ANY($2::bytea[])
      GROUP BY m.id ORDER BY token_matches DESC, m.captured_at DESC LIMIT $3
    `, [userId, tokenHashes, Math.min(Math.max(Number(limit) || 5, 1), 10)]);
    return result.rows;
  }

  async latestStored({ userId, limit = 5 }) {
    const result = await this.pool.query(`SELECT * FROM visual_memories WHERE user_id=$1 AND state='stored' AND blob_key IS NOT NULL ORDER BY captured_at DESC LIMIT $2`, [userId, Math.min(Math.max(Number(limit) || 5, 1), 10)]);
    return result.rows;
  }

  async setPinned({ userId, memoryId, pinned }) {
    const result = await this.pool.query(`UPDATE visual_memories SET pinned=$3, expires_at=CASE WHEN $3 THEN NULL ELSE COALESCE(expires_at, now() + interval '90 days') END, updated_at=now() WHERE user_id=$1 AND id=$2 AND state='stored' RETURNING *`, [userId, memoryId, pinned]);
    return result.rows[0] || null;
  }

  async setCorrection({ userId, memoryId, summary }) {
    const result = await this.pool.query(`UPDATE visual_memories SET corrected_summary=$3, updated_at=now() WHERE user_id=$1 AND id=$2 AND state='stored' RETURNING *`, [userId, memoryId, summary]);
    return result.rows[0] || null;
  }

  async setConsent({ userId, leaseId, sourceId, allow }) {
    const state = allow ? 'stored' : 'rejected';
    const result = await this.pool.query(`UPDATE visual_memories SET state=$4, pending_expires_at=NULL, expires_at=CASE WHEN $4='stored' THEN now() + interval '90 days' ELSE expires_at END, updated_at=now() WHERE user_id=$1 AND lease_id=$2 AND source_id=$3 AND state='pending_sensitive_consent' RETURNING *`, [userId, leaseId, sourceId, state]);
    return result.rows;
  }

  async pendingForConsent({ userId, leaseId, sourceId }) {
    const result = await this.pool.query(`SELECT * FROM visual_memories WHERE user_id=$1 AND lease_id=$2 AND source_id=$3 AND state='pending_sensitive_consent'`, [userId, leaseId, sourceId]);
    return result.rows;
  }

  async markDeleted({ userId, memoryId }) {
    const result = await this.pool.query(`UPDATE visual_memories SET state='deleted', updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *`, [userId, memoryId]);
    return result.rows[0] || null;
  }

  async clearBlob(memoryId) { await this.pool.query('UPDATE visual_memories SET blob_key=NULL, updated_at=now() WHERE id=$1', [memoryId]); }

  async totalStoredBytes(userId) {
    const result = await this.pool.query(`SELECT COALESCE(sum(byte_length),0)::bigint AS total FROM visual_memories WHERE user_id=$1 AND state IN ('stored','pending_sensitive_consent') AND blob_key IS NOT NULL`, [userId]);
    return Number(result.rows[0]?.total || 0);
  }

  async evictionCandidates(userId, limit = 100) {
    const result = await this.pool.query(`SELECT * FROM visual_memories WHERE user_id=$1 AND pinned=false AND blob_key IS NOT NULL AND state='stored' ORDER BY captured_at ASC LIMIT $2`, [userId, limit]);
    return result.rows;
  }

  async expirationCandidates(limit = 100) {
    const result = await this.pool.query(`
      SELECT * FROM visual_memories
      WHERE pinned=false AND blob_key IS NOT NULL AND (
        state IN ('expired','deleted','rejected')
        OR (state='stored' AND expires_at <= now())
        OR (state='pending_sensitive_consent' AND pending_expires_at <= now())
      )
      ORDER BY COALESCE(pending_expires_at, expires_at, updated_at) ASC LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async markExpired(memoryId) {
    await this.pool.query(`UPDATE visual_memories SET state='expired', updated_at=now() WHERE id=$1`, [memoryId]);
  }
}

module.exports = { VisualMemoryRepository };
