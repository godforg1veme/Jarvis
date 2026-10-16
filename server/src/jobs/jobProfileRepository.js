const { uuid, assertJobScope, profileSchema, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');

class JobProfileRepository {
  constructor(pool) { this.pool = pool; }
  async get({ userId }) {
    const row = (await this.pool.query('SELECT * FROM job_profiles WHERE user_id=$1', [uuid.parse(userId)])).rows[0];
    return row ? { ...row, profile: profileSchema.parse(row.profile) } : null;
  }
  async ensure({ scope }) {
    await assertJobScope(this.pool, scope);
    await this.pool.query(`INSERT INTO job_profiles(user_id,profile) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING`,
      [scope.userId, { confirmed: false, facts: [], examples: [] }]);
    return this.get({ userId: scope.userId });
  }
  async replace({ scope, expectedRevision, profile }) {
    profile = profileSchema.parse(profile);
    return jobTransaction(this.pool, async (client) => {
    await assertJobScope(client, scope);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
    let result;
    if (expectedRevision === 0) result = await client.query(`INSERT INTO job_profiles(user_id,profile)
      VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING RETURNING *`, [scope.userId, profile]);
    else result = await client.query(`UPDATE job_profiles SET profile=$1,revision=revision+1,updated_at=now()
      WHERE user_id=$2 AND revision=$3 RETURNING *`, [profile, scope.userId, expectedRevision]);
    if (!result.rowCount) throw jobError('JOB_REVISION_CONFLICT');
    await client.query(`UPDATE job_confirmations SET status='stale' WHERE user_id=$1 AND status='pending' AND kind='apply'`, [scope.userId]);
    return result.rows[0];
    });
  }
}

module.exports = { JobProfileRepository };
