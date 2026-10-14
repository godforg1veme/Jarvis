const { uuid, assertJobScope, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');

class JobDraftRepository {
  constructor(pool) { this.pool = pool; }
  async get({ userId, draftId }) {
    return (await this.pool.query('SELECT * FROM job_drafts WHERE user_id=$1 AND id=$2',
      [uuid.parse(userId), uuid.parse(draftId)])).rows[0] || null;
  }
  async current({ userId, vacancyId }) {
    return (await this.pool.query('SELECT * FROM job_drafts WHERE user_id=$1 AND vacancy_id=$2 AND current',
      [uuid.parse(userId), uuid.parse(vacancyId)])).rows[0] || null;
  }
  async append({ scope, vacancyId, profileRevision, vacancyRevision, parentDraftId = null, text, facts }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 10000 || !Array.isArray(facts)) throw jobError('JOB_INVALID_DRAFT');
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-draft:${scope.userId}:${vacancyId}`]);
      const allowed = await client.query(`SELECT v.id FROM job_vacancies v JOIN job_matches m ON m.vacancy_id=v.id
        JOIN job_profiles p ON p.user_id=m.user_id WHERE v.id=$1 AND m.user_id=$2
        AND v.revision=$3 AND p.revision=$4 AND p.profile->>'confirmed'='true'`,
      [uuid.parse(vacancyId), scope.userId, vacancyRevision, profileRevision]);
      if (!allowed.rowCount) throw jobError('JOB_REVISION_CONFLICT');
      const current = (await client.query('SELECT id FROM job_drafts WHERE user_id=$1 AND vacancy_id=$2 AND current FOR UPDATE',
        [scope.userId, vacancyId])).rows[0];
      if (current && current.id !== parentDraftId) throw jobError('JOB_REVISION_CONFLICT');
      if (parentDraftId && current?.id !== parentDraftId) throw jobError('JOB_REVISION_CONFLICT');
      await client.query('UPDATE job_drafts SET current=false WHERE user_id=$1 AND vacancy_id=$2 AND current', [scope.userId, vacancyId]);
      await client.query(`UPDATE job_confirmations SET status='stale' WHERE user_id=$1 AND kind='apply'
        AND status='pending' AND frozen->>'vacancyId'=$2`, [scope.userId, vacancyId]);
      return (await client.query(`INSERT INTO job_drafts(user_id,vacancy_id,parent_draft_id,profile_revision,
        vacancy_revision,text,fact_ids) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [scope.userId, vacancyId, parentDraftId, profileRevision, vacancyRevision, text.trim(), JSON.stringify(facts)])).rows[0];
    });
  }
}

module.exports = { JobDraftRepository };
