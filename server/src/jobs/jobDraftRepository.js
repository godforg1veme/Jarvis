const { uuid, assertJobScope, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');

class JobDraftRepository {
  constructor(pool, { accessService = null } = {}) { this.pool = pool; this.accessService = accessService; }
  async get({ userId, draftId }) {
    return (await this.pool.query('SELECT * FROM job_drafts WHERE user_id=$1 AND id=$2',
      [uuid.parse(userId), uuid.parse(draftId)])).rows[0] || null;
  }
  async current({ userId, vacancyId }) {
    return (await this.pool.query('SELECT * FROM job_drafts WHERE user_id=$1 AND vacancy_id=$2 AND current',
      [uuid.parse(userId), uuid.parse(vacancyId)])).rows[0] || null;
  }
  async append({ scope, vacancyId, profileRevision, vacancyRevision, parentDraftId = null, text, facts, mode = 'legacy_ai', sourceText = '', preserveText = false, client: transactionClient = null,
    resumeId, connectionRevision, replaceCurrentDraftId = null }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 10000 || !Array.isArray(facts)) throw jobError('JOB_INVALID_DRAFT');
    if (!['legacy_ai', 'base', 'improved', 'custom', 'custom_ai'].includes(mode)
      || typeof sourceText !== 'string' || sourceText.length > 10000) throw jobError('JOB_INVALID_DRAFT');
    if (replaceCurrentDraftId && (parentDraftId || !['base', 'custom', 'improved', 'custom_ai'].includes(mode)))
      throw jobError('JOB_INVALID_DRAFT');
    const appendInTransaction = async (client) => {
      await assertJobScope(client, scope, this.accessService);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-draft:${scope.userId}:${vacancyId}`]);
      const allowed = await client.query(`SELECT v.id FROM job_vacancies v JOIN job_matches m ON m.vacancy_id=v.id
        JOIN job_profiles p ON p.user_id=m.user_id WHERE v.id=$1 AND m.user_id=$2
        AND v.revision=$3 AND p.revision=$4`,
      [uuid.parse(vacancyId), scope.userId, vacancyRevision, profileRevision]);
      if (!allowed.rowCount) throw jobError('JOB_REVISION_CONFLICT');
      if (parentDraftId) {
        const parent = (await client.query('SELECT resume_id,connection_revision FROM job_drafts WHERE id=$1 AND user_id=$2',
          [parentDraftId, scope.userId])).rows[0];
        if (!parent?.resume_id || !parent.connection_revision) throw jobError('JOB_REVISION_CONFLICT');
        if (resumeId === undefined && connectionRevision === undefined) {
          resumeId = parent.resume_id;
          connectionRevision = parent.connection_revision;
        }
        if (resumeId !== parent.resume_id || connectionRevision !== parent.connection_revision)
          throw jobError('JOB_REVISION_CONFLICT');
      } else if (['base', 'custom'].includes(mode) && resumeId == null && connectionRevision == null) {
        const selected = (await client.query("SELECT resume_id,revision FROM job_connections WHERE user_id=$1 AND status='connected' FOR SHARE",
          [scope.userId])).rows[0];
        resumeId = selected?.resume_id || null;
        connectionRevision = selected?.revision || null;
      }
      resumeId ??= null;
      connectionRevision ??= null;
      if ((resumeId === null) !== (connectionRevision === null)) throw jobError('JOB_INVALID_DRAFT');
      if (resumeId !== null) {
        const selected = await client.query(`SELECT 1 FROM job_connections WHERE user_id=$1 AND status='connected'
          AND resume_id=$2 AND revision=$3 FOR SHARE`, [scope.userId, resumeId, connectionRevision]);
        if (!selected.rowCount) throw jobError('JOB_REVISION_CONFLICT');
      }
      const current = (await client.query('SELECT id FROM job_drafts WHERE user_id=$1 AND vacancy_id=$2 AND current FOR UPDATE',
        [scope.userId, vacancyId])).rows[0];
      if (current && current.id !== (replaceCurrentDraftId || parentDraftId)) throw jobError('JOB_REVISION_CONFLICT');
      if (parentDraftId && current?.id !== parentDraftId) throw jobError('JOB_REVISION_CONFLICT');
      if (replaceCurrentDraftId && current?.id !== replaceCurrentDraftId) throw jobError('JOB_REVISION_CONFLICT');
      await client.query('UPDATE job_drafts SET current=false WHERE user_id=$1 AND vacancy_id=$2 AND current', [scope.userId, vacancyId]);
      await client.query(`UPDATE job_confirmations SET status='stale' WHERE user_id=$1 AND kind='apply'
        AND status='pending' AND frozen->>'vacancyId'=$2`, [scope.userId, vacancyId]);
      return (await client.query(`INSERT INTO job_drafts(user_id,vacancy_id,parent_draft_id,profile_revision,
        vacancy_revision,text,fact_ids,letter_mode,source_text,resume_id,connection_revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [scope.userId, vacancyId, parentDraftId, profileRevision, vacancyRevision, preserveText ? text : text.trim(), JSON.stringify(facts), mode, sourceText,
        resumeId, connectionRevision])).rows[0];
    };
    return transactionClient ? appendInTransaction(transactionClient) : jobTransaction(this.pool, appendInTransaction);
  }
}

module.exports = { JobDraftRepository };
