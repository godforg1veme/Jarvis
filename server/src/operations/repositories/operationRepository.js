class OperationRepository {
  constructor(pool) { this.pool = pool; }
  async serviceCapability({ hostId, serviceKey, action }) {
    const result = await this.pool.query(`
      SELECT s.id,s.service_key
      FROM ops_services s JOIN ops_service_capabilities c ON c.service_id=s.id
      WHERE s.host_id=$1 AND s.service_key=$2 AND c.action=$3 AND c.enabled=true
    `, [hostId, serviceKey, action]);
    return result.rows[0] || null;
  }
  async createOrGet({ id, sessionId, hostId, operation, targetKey, idempotencyHash, fingerprint }) {
    const inserted = await this.pool.query(`
      INSERT INTO ops_operation_runs (id,panel_session_id,host_id,operation,target_key,idempotency_key_hash,request_fingerprint,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') ON CONFLICT (panel_session_id,idempotency_key_hash) DO NOTHING
      RETURNING *,true AS created
    `, [id, sessionId, hostId, operation, targetKey, idempotencyHash, fingerprint]);
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await this.pool.query(`
      SELECT *,false AS created FROM ops_operation_runs
      WHERE panel_session_id=$1 AND idempotency_key_hash=$2
    `, [sessionId, idempotencyHash]);
    return existing.rows[0] || null;
  }
  async complete({ id, status, result = null, errorCode = null }) {
    const saved = await this.pool.query(`
      UPDATE ops_operation_runs SET status=$2,result=$3::jsonb,error_code=$4,updated_at=now(),
        completed_at=CASE WHEN $2 IN ('pending','accepted') THEN NULL ELSE now() END
      WHERE id=$1 AND status IN ('pending','accepted','unknown') RETURNING *
    `, [id, status, result ? JSON.stringify(result) : null, errorCode]);
    if (saved.rows[0]) return saved.rows[0];
    const existing = await this.pool.query(`SELECT * FROM ops_operation_runs WHERE id=$1`, [id]);
    return existing.rows[0] || null;
  }
  async recoverable(limit = 20) {
    const result = await this.pool.query(`
      SELECT id,status,created_at FROM ops_operation_runs
      WHERE status IN ('pending','accepted','unknown') AND created_at > now()-interval '24 hours'
      ORDER BY updated_at LIMIT $1
    `, [Math.min(Math.max(Number(limit) || 20, 1), 100)]);
    return result.rows;
  }
}
module.exports = { OperationRepository };
