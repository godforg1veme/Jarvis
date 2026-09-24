class PanelSessionRepository {
  constructor(pool) { this.pool = pool; }
  async createRequest({ verifierHash, label, metadata }) {
    const result = await this.pool.query(`INSERT INTO ops_panel_approval_requests (browser_verifier_hash,browser_label,client_metadata,expires_at) VALUES ($1,$2,$3::jsonb,now()+interval '5 minutes') RETURNING id,expires_at,state`, [verifierHash, label, JSON.stringify(metadata || {})]);
    return result.rows[0];
  }
  async getRequest({ id, verifierHash }) {
    const result = await this.pool.query(`
      UPDATE ops_panel_approval_requests
      SET state = CASE WHEN state = 'pending' AND expires_at <= now() THEN 'expired' ELSE state END
      WHERE id = $1 AND browser_verifier_hash = $2
      RETURNING id,state,expires_at,decided_at,consumed_at
    `, [id, verifierHash]);
    return result.rows[0] || null;
  }
  async decide({ id, approved }) {
    const result = await this.pool.query(`UPDATE ops_panel_approval_requests SET state=$2,decided_at=now() WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING id,state`, [id, approved ? 'approved' : 'denied']);
    return result.rows[0] || null;
  }
  async consumeApproved({ id, verifierHash, credentialHash, label, metadata }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const request = await client.query(`UPDATE ops_panel_approval_requests SET state='consumed',consumed_at=now() WHERE id=$1 AND browser_verifier_hash=$2 AND state='approved' AND expires_at>now() RETURNING id`, [id, verifierHash]);
      if (request.rowCount !== 1) { await client.query('ROLLBACK'); return null; }
      const session = await client.query(`INSERT INTO ops_panel_sessions (credential_hash,label,client_metadata) VALUES ($1,$2,$3::jsonb) RETURNING id,created_at,last_used_at`, [credentialHash, label, JSON.stringify(metadata || {})]);
      await client.query('COMMIT'); return session.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async findActiveSession(credentialHash) {
    const result = await this.pool.query(`
      SELECT id,label,created_at,last_used_at
      FROM ops_panel_sessions
      WHERE credential_hash=$1 AND revoked_at IS NULL
    `, [credentialHash]);
    const session = result.rows[0] || null;
    if (session && new Date(session.last_used_at).getTime() < Date.now() - (5 * 60 * 1000)) {
      await this.pool.query(`UPDATE ops_panel_sessions SET last_used_at=now() WHERE id=$1 AND revoked_at IS NULL AND last_used_at < now()-interval '5 minutes'`, [session.id]);
    }
    return session;
  }
  async listActiveSessions() {
    const result = await this.pool.query(`
      SELECT id,label,client_metadata,created_at,last_used_at
      FROM ops_panel_sessions
      WHERE revoked_at IS NULL
      ORDER BY last_used_at DESC, created_at DESC
      LIMIT 100
    `);
    return result.rows;
  }
  async revokeSession(id, reason = 'owner_forget') {
    const result = await this.pool.query(`
      UPDATE ops_panel_sessions SET revoked_at=now(),revoked_reason=$2
      WHERE id=$1 AND revoked_at IS NULL
      RETURNING id
    `, [id, reason]);
    return result.rows[0] || null;
  }
}
module.exports = { PanelSessionRepository };
