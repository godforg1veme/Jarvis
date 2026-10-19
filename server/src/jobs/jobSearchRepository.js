const crypto = require('node:crypto');
const { uuid, settingsSchema, defaultJobSettings, assertUserJobAccess, assertJobScope, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');

class JobSearchRepository {
  constructor(pool, { defaults = {}, accessService = null } = {}) { this.pool = pool; this.defaults = defaults; this.accessService = accessService; }

  async ensure({ scope }) {
    const settings = settingsSchema.parse({ ...defaultJobSettings(), ...this.defaults });
    await jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      await client.query(`INSERT INTO job_searches(user_id,conversation_id,chat_id,settings)
        VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING`, [scope.userId, scope.conversationId, scope.chatId, settings]);
    });
    return this.getSettings({ userId: scope.userId });
  }

  async getSettings({ userId }) {
    uuid.parse(userId);
    return (await this.pool.query('SELECT * FROM job_searches WHERE user_id=$1', [userId])).rows[0] || null;
  }

  async saveSettings({ scope, expectedRevision, settings }) {
    settings = settingsSchema.parse(settings);
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      const row = (await client.query(`UPDATE job_searches SET settings=$1,revision=revision+1,
        conversation_id=$2,chat_id=$3,next_check_at=now(),progress=NULL,lease_id=NULL,lease_until=NULL,updated_at=now()
        WHERE user_id=$4 AND revision=$5 RETURNING *`,
      [settings, scope.conversationId, scope.chatId, scope.userId, expectedRevision])).rows[0];
      if (!row) throw jobError('JOB_REVISION_CONFLICT');
      return row;
    });
  }

  async setEnabled({ scope, expectedRevision, enabled }) {
    if (typeof enabled !== 'boolean') throw jobError('JOB_INVALID_SETTINGS_INPUT');
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      const row = (await client.query(`UPDATE job_searches SET
        settings=jsonb_set(jsonb_set(settings,'{activated}',to_jsonb($1::boolean)),'{paused}',to_jsonb(NOT $1::boolean)),
        revision=revision+1,conversation_id=$2,chat_id=$3,
        next_check_at=CASE WHEN $1::boolean THEN now() ELSE next_check_at END,
        lease_id=NULL,lease_until=NULL,status='idle',failure_code=NULL,updated_at=now()
        WHERE user_id=$4 AND revision=$5
        AND (settings->>'activated' IS DISTINCT FROM ($1::boolean)::text OR settings->>'paused' IS DISTINCT FROM (NOT $1::boolean)::text)
        RETURNING *`, [enabled, scope.conversationId, scope.chatId, scope.userId, expectedRevision])).rows[0];
      if (row) return row;
      const current = (await client.query('SELECT * FROM job_searches WHERE user_id=$1', [scope.userId])).rows[0];
      if (current?.settings.activated === enabled && current.settings.paused === !enabled) return current;
      throw jobError('JOB_REVISION_CONFLICT');
    });
  }

  async upsertVacancy({ source = 'hh', externalId, snapshot }) {
    if (source !== 'hh' || !/^\d{1,20}$/.test(externalId)) throw jobError('JOB_INVALID_VACANCY');
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > 128 * 1024 || !Number.isFinite(Date.parse(snapshot.publishedAt))) throw jobError('JOB_INVALID_VACANCY');
    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    return (await this.pool.query(`INSERT INTO job_vacancies(source,external_id,snapshot,content_hash,published_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(source,external_id) DO UPDATE SET
      snapshot=excluded.snapshot, content_hash=excluded.content_hash,published_at=excluded.published_at,
      revision=job_vacancies.revision+CASE WHEN job_vacancies.content_hash<>excluded.content_hash THEN 1 ELSE 0 END,
      updated_at=now() RETURNING *`, [source, externalId, snapshot, hash, snapshot.publishedAt])).rows[0];
  }

  async recordMatch({ userId, vacancyId, filterRevision, annotations = [] }) {
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      return (await client.query(`INSERT INTO job_matches(user_id,vacancy_id,filter_revision,annotations)
        VALUES($1,$2,$3,$4) ON CONFLICT(user_id,vacancy_id) DO UPDATE SET
        filter_revision=excluded.filter_revision,annotations=excluded.annotations RETURNING *`,
      [uuid.parse(userId), uuid.parse(vacancyId), filterRevision, JSON.stringify(annotations)])).rows[0];
    });
  }

  async getVacancy({ userId, vacancyId }) {
    return (await this.pool.query(`SELECT v.*,m.saved,m.hidden,m.annotations FROM job_vacancies v
      JOIN job_matches m ON m.vacancy_id=v.id WHERE v.id=$1 AND m.user_id=$2`,
    [uuid.parse(vacancyId), uuid.parse(userId)])).rows[0] || null;
  }

  async mark({ scope, vacancyId, action }) {
    if (!['save', 'hide'].includes(action)) throw jobError('JOB_INVALID_ACTION');
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      const rows = await client.query(`UPDATE job_matches SET saved=CASE WHEN $1='save' THEN true ELSE saved END,
        hidden=CASE WHEN $1='hide' THEN true ELSE hidden END WHERE user_id=$2 AND vacancy_id=$3 RETURNING id`,
      [action, scope.userId, uuid.parse(vacancyId)]);
      if (!rows.rowCount) throw jobError('JOB_NOT_FOUND');
    });
  }

  async list({ userId, saved = false, page = 0 }) {
    if (!Number.isInteger(page) || page < 0 || page > 9999) throw jobError('JOB_INVALID_PAGE');
    return (await this.pool.query(`SELECT v.*,m.saved,m.annotations FROM job_vacancies v
      JOIN job_matches m ON m.vacancy_id=v.id WHERE m.user_id=$1 AND NOT m.hidden
      AND (NOT $2::boolean OR m.saved) ORDER BY v.published_at DESC,v.id LIMIT 10 OFFSET $3`,
    [uuid.parse(userId), saved, page * 10])).rows;
  }

  async claimSearch({ userId, now, force = false }) {
    const leaseId = crypto.randomUUID();
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      return (await client.query(`UPDATE job_searches SET lease_id=$1,lease_until=$2::timestamptz+interval '5 minutes',
        status='collecting' WHERE user_id=$3 AND (lease_until IS NULL OR lease_until<$2)
        AND settings->>'activated'='true' AND settings->>'paused'='false'
        AND ($4::boolean OR next_check_at<=$2) RETURNING *`, [leaseId, now, uuid.parse(userId), force])).rows[0] || null;
    });
  }

  async finishSearch({ userId, leaseId, checkpoint, nextCheckAt, failureCode = null }) {
    return jobTransaction(this.pool, async (client) => {
      try { await assertUserJobAccess(client, this.accessService, userId); } catch { return false; }
      return (await client.query(`UPDATE job_searches SET checkpoint=COALESCE($1,checkpoint),next_check_at=$2,
        progress=CASE WHEN $1::timestamptz IS NOT NULL THEN NULL ELSE progress END,
        lease_id=NULL,lease_until=NULL,status=$3,failure_code=$4,updated_at=now()
        WHERE user_id=$5 AND lease_id=$6 RETURNING id`, [checkpoint, nextCheckAt,
        failureCode ? 'attention' : 'idle', failureCode, userId, leaseId])).rowCount === 1;
    });
  }

  async saveProgress({ userId, leaseId, progress }) {
    if (Buffer.byteLength(JSON.stringify(progress)) > 128 * 1024) throw jobError('JOB_COLLECTION_LIMIT');
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      const row = await client.query('UPDATE job_searches SET progress=$1 WHERE user_id=$2 AND lease_id=$3 RETURNING id', [progress, userId, leaseId]);
      if (!row.rowCount) throw jobError('JOB_COLLECTION_CHANGED');
    });
  }

  async renewSearch({ userId, leaseId, revision, now }) {
    return jobTransaction(this.pool, async (client) => {
      try { await assertUserJobAccess(client, this.accessService, userId); } catch { return false; }
      return (await client.query(`UPDATE job_searches SET lease_until=$1::timestamptz+interval '5 minutes'
        WHERE user_id=$2 AND lease_id=$3 AND revision=$4 AND settings->>'paused'='false' RETURNING id`,
      [now, userId, leaseId, revision])).rowCount === 1;
    });
  }

  async dueUsers({ now = new Date() } = {}) {
    const candidates = (await this.pool.query(`SELECT user_id FROM job_searches WHERE next_check_at<=$1
      AND settings->>'activated'='true' AND settings->>'paused'='false' ORDER BY next_check_at LIMIT 100`, [now])).rows;
    const allowed = [];
    for (const row of candidates) {
      try { await assertUserJobAccess(this.pool, this.accessService, row.user_id); allowed.push(row); }
      catch { /* Revoked users are skipped before their search is claimed. */ }
    }
    return allowed;
  }
}

module.exports = { JobSearchRepository };
