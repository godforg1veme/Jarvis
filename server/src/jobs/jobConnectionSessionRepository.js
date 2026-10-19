const { jobError } = require('./jobSchemas');

class JobConnectionSessionRepository {
  constructor(pool) { this.pool = pool; }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async connected(client, userId) {
    return (await client.query(`SELECT status,resume_id,revision FROM job_connections WHERE user_id=$1`, [userId])).rows[0] || null;
  }

  async expireDue() {
    return this.transaction(async (client) => (await client.query(`WITH due AS (
      SELECT id,user_id FROM job_hh_login_sessions
      WHERE status IN ('pending','claimed','authenticated') AND expires_at<=now()
      ORDER BY expires_at,id LIMIT 50 FOR UPDATE SKIP LOCKED
    ) UPDATE job_hh_login_sessions s SET status='expired',ticket_hash=NULL,guest_token_hash=NULL,
      completed_at=COALESCE(s.completed_at,now()),updated_at=now()
      FROM due WHERE s.id=due.id AND s.user_id=due.user_id
      RETURNING s.id,s.user_id`)).rows);
  }

  async createOrRefresh(client, row) {
    const connected = await this.connected(client, row.userId);
    if (connected?.status === 'connected') return { status: 'connected', connected: true };

    const expired = (await client.query(`UPDATE job_hh_login_sessions SET status='expired',ticket_hash=NULL,guest_token_hash=NULL,
      completed_at=COALESCE(completed_at,now()),updated_at=now()
      WHERE user_id=$1 AND status IN ('pending','claimed','authenticated') AND expires_at<=$2 RETURNING id`, [row.userId, row.now])).rows;

    const active = (await client.query(`SELECT * FROM job_hh_login_sessions
      WHERE user_id=$1 AND status IN ('pending','claimed','authenticated') FOR UPDATE`, [row.userId])).rows[0];
    if (active) {
      const resumed = (await client.query(`UPDATE job_hh_login_sessions SET ticket_hash=$2,guest_token_hash=NULL,
        status='pending',claimed_at=NULL,membership_revision=$3,role_id=$4,role_revision=$5,ticket_expires_at=$6,updated_at=now()
        WHERE id=$1 RETURNING *`, [active.id, row.ticketHash, row.membershipRevision, row.roleId,
        row.roleRevision, new Date(Math.min(row.ticketExpiresAt.getTime(), new Date(active.expires_at).getTime()))])).rows[0];
      return { ...resumed, ticketIssued: true, expiredSessionIds: expired.map((item) => item.id) };
    }

    let existing = (await client.query(`SELECT * FROM job_hh_login_sessions
      WHERE user_id=$1 AND request_id=$2 FOR UPDATE`, [row.userId, row.requestId])).rows[0];

    if (existing && ['confirmed','cancelled','expired','revoked','failed'].includes(existing.status)) {
      existing = (await client.query(`UPDATE job_hh_login_sessions SET ticket_hash=$3,guest_token_hash=NULL,
        membership_revision=$4,role_id=$5,role_revision=$6,status='pending',resume_id=NULL,
        ticket_expires_at=$7,expires_at=$8,claimed_at=NULL,completed_at=NULL,updated_at=now()
        WHERE user_id=$1 AND request_id=$2 RETURNING *`,
      [row.userId, row.requestId, row.ticketHash, row.membershipRevision, row.roleId, row.roleRevision,
        row.ticketExpiresAt, row.expiresAt])).rows[0];
      return { ...existing, ticketIssued: true, expiredSessionIds: expired.map((item) => item.id) };
    }

    if (existing?.status === 'pending') {
      existing = (await client.query(`UPDATE job_hh_login_sessions SET ticket_hash=$3,guest_token_hash=NULL,
        membership_revision=$4,role_id=$5,role_revision=$6,ticket_expires_at=$7,expires_at=$8,updated_at=now()
        WHERE user_id=$1 AND request_id=$2 RETURNING *`,
      [row.userId, row.requestId, row.ticketHash, row.membershipRevision, row.roleId, row.roleRevision,
        row.ticketExpiresAt, row.expiresAt])).rows[0];
      return { ...existing, ticketIssued: true, expiredSessionIds: expired.map((item) => item.id) };
    }

    if (existing) return { ...existing, ticketIssued: false };

    try {
      const inserted = (await client.query(`INSERT INTO job_hh_login_sessions
        (user_id,request_id,ticket_hash,membership_revision,role_id,role_revision,status,ticket_expires_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING *`,
      [row.userId, row.requestId, row.ticketHash, row.membershipRevision, row.roleId, row.roleRevision,
        row.ticketExpiresAt, row.expiresAt])).rows[0];
      return { ...inserted, ticketIssued: true, expiredSessionIds: expired.map((item) => item.id) };
    } catch (error) {
      if (error.code === '23505') throw jobError('JOB_LOGIN_ALREADY_ACTIVE');
      throw error;
    }
  }

  async byTicketForUpdate(client, ticketHash) {
    return (await client.query('SELECT * FROM job_hh_login_sessions WHERE ticket_hash=$1 FOR UPDATE', [ticketHash])).rows[0] || null;
  }

  async claimLocked(client, { id, guestTokenHash }) {
    const row = (await client.query(`UPDATE job_hh_login_sessions SET guest_token_hash=$2,
      status='claimed',
      claimed_at=COALESCE(claimed_at,now()),updated_at=now()
      WHERE id=$1 AND status='pending' AND ticket_expires_at>now() AND expires_at>now()
        AND ticket_hash IS NOT NULL AND guest_token_hash IS NULL
      RETURNING *`, [id, guestTokenHash])).rows[0];
    return row || null;
  }

  async byGuestHash(client, guestTokenHash) {
    return (await client.query('SELECT * FROM job_hh_login_sessions WHERE guest_token_hash=$1 FOR UPDATE', [guestTokenHash])).rows[0] || null;
  }

  async byIdForUser(client, { sessionId, userId }) {
    return (await client.query('SELECT * FROM job_hh_login_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [sessionId, userId])).rows[0] || null;
  }

  async setStatus(client, { sessionId, userId, status }) {
    const terminal = ['confirmed','cancelled','expired','revoked','failed'].includes(status);
    return (await client.query(`UPDATE job_hh_login_sessions SET status=$3,
      ticket_hash=CASE WHEN $4::boolean THEN NULL ELSE ticket_hash END,
      guest_token_hash=CASE WHEN $4::boolean THEN NULL ELSE guest_token_hash END,
      completed_at=CASE WHEN $4::boolean THEN COALESCE(completed_at,now()) ELSE completed_at END,
      updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,
    [sessionId, userId, status, terminal])).rows[0] || null;
  }

  async confirmLocked(client, { sessionId, userId, resumeId }) {
    const row = (await client.query(`SELECT * FROM job_hh_login_sessions
      WHERE id=$1 AND user_id=$2 AND status='authenticated' AND expires_at>now() FOR UPDATE`, [sessionId, userId])).rows[0];
    if (!row) throw jobError('JOB_LOGIN_SESSION_INVALID');
    const connection = (await client.query(`INSERT INTO job_connections(user_id,resume_id,status,revision,updated_at)
      VALUES($1,$2,'connected',1,now())
      ON CONFLICT(user_id) DO UPDATE SET resume_id=EXCLUDED.resume_id,status='connected',
        revision=job_connections.revision+1,refresh_operation_id=NULL,updated_at=now()
      RETURNING id,revision`, [userId, resumeId])).rows[0];
    const confirmed = (await client.query(`UPDATE job_hh_login_sessions SET status='confirmed',resume_id=$3,
      ticket_hash=NULL,guest_token_hash=NULL,completed_at=COALESCE(completed_at,now()),updated_at=now()
      WHERE id=$1 AND user_id=$2 AND status='authenticated' RETURNING *`, [sessionId, userId, resumeId])).rows[0];
    if (!confirmed) throw jobError('JOB_LOGIN_SESSION_INVALID');
    return { row: confirmed, connection };
  }
}

module.exports = { JobConnectionSessionRepository };
