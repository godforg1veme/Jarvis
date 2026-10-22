const INTERVAL = 4 * 60 * 60 * 1000;

async function applyResumeDefaults(c, userId, connection, manager, now) {
  if (manager.auto_raise_policy_applied || connection?.status !== 'connected' || !connection.resume_id) return manager;
  // Recovery of an old unknown receipt must never become a fresh opt-in.
  if (manager.last_outcome === 'unknown') return (await c.query(`UPDATE job_resume_managers
    SET auto_raise_policy_applied=true,auto_raise_enabled=false,next_raise_at=NULL WHERE user_id=$1 RETURNING *`,[userId])).rows[0];
  const pending = await c.query(`SELECT 1 FROM job_resume_operations WHERE user_id=$1
    AND kind IN ('settings','raise') AND status IN ('working','unknown') LIMIT 1`, [userId]);
  if (pending.rowCount) return manager;
  const enabled = manager.auto_raise_preference !== false && manager.last_outcome !== 'unknown';
  const next = Math.max(now(), manager.last_raise_at ? new Date(manager.last_raise_at).getTime() + INTERVAL : 0);
  return (await c.query(`UPDATE job_resume_managers SET auto_raise_policy_applied=true,
    auto_raise_enabled=$2,auto_raise_resume_id=$3,next_raise_at=$4,updated_at=now()
    WHERE user_id=$1 AND NOT auto_raise_policy_applied RETURNING *`,
  [userId, enabled, connection.resume_id, enabled ? new Date(next) : null])).rows[0] ?? manager;
}

module.exports = { applyResumeDefaults };
