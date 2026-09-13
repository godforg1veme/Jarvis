class VpnRepository {
  constructor(pool) { this.pool = pool; }

  async isOwner({ userId, ownerTelegramId }) {
    const result = await this.pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM users u
        LEFT JOIN user_identities i ON i.user_id=u.id AND i.provider='telegram'
        WHERE u.id=$1 AND (u.role='owner' OR i.external_id=$2)
      ) AS allowed
    `, [userId, String(ownerTelegramId || '')]);
    return result.rows[0]?.allowed === true;
  }

  async create(input) {
    const result = await this.pool.query(`
      INSERT INTO vpn_action_requests (
        id,user_id,conversation_id,origin_channel,origin_device_id,action,arguments,
        request_fingerprint,status,expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'awaiting_confirmation',$9)
      RETURNING *
    `, [input.id, input.userId, input.conversationId || null, input.originChannel,
      input.originDeviceId || null, input.action, JSON.stringify(input.arguments || {}),
      input.fingerprint, input.expiresAt]);
    await this.audit({ userId: input.userId, requestId: input.id, type: 'vpn.action.created', metadata: { action: input.action, originChannel: input.originChannel } });
    return result.rows[0];
  }

  async get({ userId, requestId }) {
    const result = await this.pool.query('SELECT * FROM vpn_action_requests WHERE id=$1 AND user_id=$2', [requestId, userId]);
    return result.rows[0] || null;
  }

  async latestPending({ userId, originChannel, originDeviceId = null }) {
    const result = await this.pool.query(`
      SELECT * FROM vpn_action_requests
      WHERE user_id=$1 AND origin_channel=$2 AND origin_device_id IS NOT DISTINCT FROM $3::uuid
        AND status='awaiting_confirmation' AND expires_at>now()
      ORDER BY created_at DESC LIMIT 1
    `, [userId, originChannel, originDeviceId]);
    return result.rows[0] || null;
  }

  async approve({ userId, requestId, originChannel, originDeviceId = null }) {
    const result = await this.pool.query(`
      UPDATE vpn_action_requests SET status='running',updated_at=now()
      WHERE id=$1 AND user_id=$2 AND status='awaiting_confirmation' AND expires_at>now()
        AND origin_channel=$3 AND origin_device_id IS NOT DISTINCT FROM $4::uuid
      RETURNING *
    `, [requestId, userId, originChannel, originDeviceId]);
    return result.rows[0] || null;
  }

  async reject({ userId, requestId, originChannel, originDeviceId = null }) {
    const result = await this.pool.query(`
      UPDATE vpn_action_requests SET status='cancelled',updated_at=now(),completed_at=now()
      WHERE id=$1 AND user_id=$2 AND status='awaiting_confirmation' AND expires_at>now()
        AND origin_channel=$3 AND origin_device_id IS NOT DISTINCT FROM $4::uuid
      RETURNING *
    `, [requestId, userId, originChannel, originDeviceId]);
    return result.rows[0] || null;
  }

  async complete({ requestId, status, result = null, errorCode = null }) {
    const saved = await this.pool.query(`
      UPDATE vpn_action_requests SET status=$2,result=$3::jsonb,error_code=$4,updated_at=now(),
        completed_at=CASE WHEN $2 IN ('running','unknown') THEN completed_at ELSE now() END
      WHERE id=$1 AND status IN ('running','unknown') RETURNING *
    `, [requestId, status, result ? JSON.stringify(result) : null, errorCode]);
    if (saved.rows[0]) return saved.rows[0];
    const existing = await this.pool.query('SELECT * FROM vpn_action_requests WHERE id=$1', [requestId]);
    return existing.rows[0] || null;
  }

  async recoverable(limit = 20) {
    const result = await this.pool.query(`
      SELECT * FROM vpn_action_requests
      WHERE status IN ('running','unknown') AND created_at>now()-interval '24 hours'
      ORDER BY updated_at LIMIT $1
    `, [Math.min(Math.max(Number(limit) || 20, 1), 100)]);
    return result.rows;
  }

  async audit({ userId, requestId = null, type, metadata = {} }) {
    await this.pool.query(`
      INSERT INTO vpn_audit_events (user_id,action_request_id,event_type,metadata)
      VALUES ($1,$2,$3,$4::jsonb)
    `, [userId, requestId, type, JSON.stringify(metadata)]);
  }
}

module.exports = { VpnRepository };
