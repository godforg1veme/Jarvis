class ConnectionAdminRepository {
  constructor(pool) { this.pool = pool; }

  async listProfiles() {
    const result = await this.pool.query(`
      SELECT id,display_name,role,created_at
      FROM users
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, display_name, id
      LIMIT 100
    `);
    return result.rows;
  }

  async listTelegramIdentities() {
    const result = await this.pool.query(`
      SELECT id,user_id,external_id,created_at
      FROM user_identities
      WHERE provider='telegram'
      ORDER BY created_at,id
      LIMIT 200
    `);
    return result.rows;
  }

  async listDevices() {
    const result = await this.pool.query(`
      SELECT id,user_id,name,
        CASE WHEN status='online' AND (last_seen_at IS NULL OR last_seen_at < now()-interval '90 seconds') THEN 'offline' ELSE status END AS status,
        device_kind,last_seen_at,created_at,updated_at
      FROM devices
      ORDER BY updated_at DESC,created_at DESC,id
      LIMIT 500
    `);
    return result.rows;
  }

  async reassignTelegram({ identityId, targetUserId, panelSessionId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await client.query(`SELECT id,user_id,external_id FROM user_identities WHERE id=$1 AND provider='telegram' FOR UPDATE`, [identityId]);
      if (identity.rowCount !== 1) { await client.query('ROLLBACK'); return null; }
      const users = await client.query(`SELECT id FROM users WHERE id=ANY($1::uuid[]) FOR UPDATE`, [[identity.rows[0].user_id, targetUserId]]);
      if (!users.rows.some((user) => user.id === targetUserId)) { await client.query('ROLLBACK'); return null; }
      await client.query(`UPDATE user_identities SET user_id=$2 WHERE id=$1`, [identityId, targetUserId]);
      await client.query(`INSERT INTO ops_admin_audit (panel_session_id,event_type,metadata) VALUES ($1,'connection.telegram_reassigned',$2::jsonb)`, [panelSessionId, JSON.stringify({ identityId, fromUserId: identity.rows[0].user_id, toUserId: targetUserId })]);
      await client.query('COMMIT'); return { id: identityId, externalId: identity.rows[0].external_id, fromUserId: identity.rows[0].user_id, targetUserId };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async beginDeviceReassignment({ deviceId, targetUserId, panelSessionId, codeHash, expiresAt }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const device = await client.query(`SELECT id,user_id,name,status FROM devices WHERE id=$1 FOR UPDATE`, [deviceId]);
      if (device.rowCount !== 1 || device.rows[0].status === 'revoked') { await client.query('ROLLBACK'); return null; }
      const target = await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [targetUserId]);
      if (target.rowCount !== 1) { await client.query('ROLLBACK'); return null; }
      await client.query(`UPDATE commands SET status='cancelled',error_code='DEVICE_REASSIGNED',completed_at=now(),updated_at=now() WHERE device_id=$1 AND status IN ('pending','awaiting_confirmation','queued','running')`, [deviceId]);
      await client.query(`UPDATE devices SET status='revoked',updated_at=now() WHERE id=$1`, [deviceId]);
      const pairing = await client.query(`INSERT INTO device_pairing_codes (user_id,code_hash,device_name,expires_at,source_device_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [targetUserId, codeHash, device.rows[0].name, expiresAt, deviceId]);
      const reassignment = await client.query(`INSERT INTO device_reassignments (old_device_id,target_user_id,pairing_code_id,status,audit_metadata) VALUES ($1,$2,$3,'pending_claim',$4::jsonb) RETURNING id`, [deviceId, targetUserId, pairing.rows[0].id, JSON.stringify({ fromUserId: device.rows[0].user_id, panelSessionId })]);
      await client.query(`INSERT INTO ops_admin_audit (panel_session_id,event_type,metadata) VALUES ($1,'connection.device_reassignment_started',$2::jsonb)`, [panelSessionId, JSON.stringify({ reassignmentId: reassignment.rows[0].id, oldDeviceId: deviceId, fromUserId: device.rows[0].user_id, toUserId: targetUserId })]);
      await client.query('COMMIT'); return { id: reassignment.rows[0].id, deviceName: device.rows[0].name, expiresAt };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}

module.exports = { ConnectionAdminRepository };
