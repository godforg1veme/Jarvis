class VpnSupervisorRepository {
  constructor(pool) { this.pool = pool; }

  async createPlanning(input) {
    try {
      const result = await this.pool.query(`
        INSERT INTO vpn_supervisor_runs (
          id,host_id,synthetic,status,incident_code,incident_revision,
          prompt_version,catalog_version,evidence_digest,safe_metadata,expires_at
        ) VALUES ($1,$2,$3,'planning',$4,$5,$6,$7,$8,$9::jsonb,$10)
        RETURNING *
      `, [input.id, input.hostId, input.synthetic, input.incidentCode, input.incidentRevision,
        input.promptVersion, input.catalogVersion, input.evidenceDigest,
        JSON.stringify(input.safeMetadata || {}), input.expiresAt]);
      return result.rows[0];
    } catch (error) {
      if (error?.code === '23505') { const conflict = new Error('VPN Supervisor acceptance is already active'); conflict.code = 'VPN_SUPERVISOR_ALREADY_ACTIVE'; throw conflict; }
      throw error;
    }
  }

  async saveProposal({ id, playbookId, reasonCode, confidence, safeMetadata }) {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='awaiting_owner',playbook_id=$2,
        reason_code=$3,confidence=$4,safe_metadata=$5::jsonb,updated_at=now()
      WHERE id=$1 AND status='planning' AND expires_at>now() RETURNING *
    `, [id, playbookId, reasonCode, confidence, JSON.stringify(safeMetadata || {})]);
    return result.rows[0] || null;
  }

  async fail(id, code) {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='failed',reason_code=$2,
        completed_at=now(),updated_at=now()
      WHERE id=$1 AND status IN ('planning','awaiting_owner') RETURNING *
    `, [id, code]);
    return result.rows[0] || null;
  }

  async find(id) {
    const result = await this.pool.query('SELECT * FROM vpn_supervisor_runs WHERE id=$1', [id]);
    return result.rows[0] || null;
  }

  async decide({ id, approved }) {
    const status = approved ? 'approved' : 'rejected';
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status=$2,decided_at=now(),
        completed_at=CASE WHEN $2='rejected' THEN now() ELSE NULL END,updated_at=now()
      WHERE id=$1 AND status='awaiting_owner' AND expires_at>now()
      RETURNING *
    `, [id, status]);
    if (result.rows[0]) return result.rows[0];
    await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='expired',completed_at=now(),updated_at=now()
      WHERE id=$1 AND status='awaiting_owner' AND expires_at<=now()
    `, [id]);
    return null;
  }

  async markStale(id) {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='stale',completed_at=now(),updated_at=now()
      WHERE id=$1 AND status='approved' RETURNING *
    `, [id]);
    return result.rows[0] || null;
  }

  async completeNoop(id) {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='succeeded',completed_at=now(),updated_at=now()
      WHERE id=$1 AND status='approved' AND synthetic=true
        AND playbook_id='supervisor_acceptance_noop'
      RETURNING *
    `, [id]);
    return result.rows[0] || null;
  }

  async claimRepair({ id, requestId, operation, startedAt }) {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs AS current SET status='executing',
        safe_metadata=current.safe_metadata || jsonb_build_object(
          'repairRequestId',$2::text,'repairOperation',$3::text,'repairStartedAt',$4::text
        ), updated_at=now()
      WHERE current.id=$1 AND current.synthetic=false AND current.status='approved' AND current.expires_at>now()
        AND NOT (current.safe_metadata ? 'repairRequestId')
        AND NOT EXISTS (
          SELECT 1 FROM vpn_supervisor_runs previous
          WHERE previous.host_id=current.host_id AND previous.synthetic=false
            AND previous.id<>current.id AND (previous.safe_metadata ? 'repairRequestId')
            AND (previous.safe_metadata->>'repairStartedAt')::timestamptz > now()-interval '15 minutes'
        )
      RETURNING *
    `, [id, requestId, operation, startedAt]);
    return result.rows[0] || null;
  }

  async failUnstartedRepair({ id, errorCode }) {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='failed',
        safe_metadata=safe_metadata || jsonb_build_object('repairResultCode',$2::text),
        completed_at=now(),updated_at=now()
      WHERE id=$1 AND status='approved' AND NOT (safe_metadata ? 'repairRequestId')
      RETURNING *
    `, [id, errorCode]);
    return result.rows[0] || null;
  }

  async completeRepair({ id, status, errorCode = null }) {
    if (!['succeeded', 'failed', 'unknown'].includes(status)) throw new Error('VPN_SUPERVISOR_REPAIR_STATUS_INVALID');
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status=$2,
        safe_metadata=safe_metadata || jsonb_build_object('repairResultCode',$3::text),
        completed_at=CASE WHEN $2='unknown' THEN NULL ELSE now() END,
        updated_at=now()
      WHERE id=$1 AND status IN ('executing','verifying','unknown') RETURNING *
    `, [id, status, errorCode]);
    return result.rows[0] || null;
  }

  async markVerifying(id) {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='verifying',updated_at=now()
      WHERE id=$1 AND status IN ('executing','verifying','unknown') RETURNING *
    `, [id]);
    return result.rows[0] || null;
  }

  async recoverableRepairs() {
    const result = await this.pool.query(`
      SELECT * FROM vpn_supervisor_runs
      WHERE synthetic=false AND status IN ('approved','executing','verifying','unknown')
      ORDER BY created_at ASC LIMIT 20
    `);
    return result.rows;
  }

  async expirePending() {
    const result = await this.pool.query(`
      UPDATE vpn_supervisor_runs SET status='expired',completed_at=now(),updated_at=now()
      WHERE status IN ('planning','awaiting_owner') AND expires_at<=now()
      RETURNING id
    `);
    return result.rows;
  }

  async deleteOldTerminal() {
    const result = await this.pool.query(`
      DELETE FROM vpn_supervisor_runs WHERE id IN (
        SELECT id FROM vpn_supervisor_runs
        WHERE status IN ('rejected','succeeded','expired','stale','failed')
          AND completed_at<now()-interval '60 days'
        ORDER BY completed_at LIMIT 1000
      )
    `);
    return result.rowCount;
  }
}

module.exports = { VpnSupervisorRepository };
