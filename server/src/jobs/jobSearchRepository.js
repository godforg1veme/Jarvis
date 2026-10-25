const crypto = require('node:crypto');
const { uuid, settingsSchema, parseJobSettings, defaultJobSettings, assertUserJobAccess, assertJobScope, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');
const HAS_QUERIES_SQL = "jsonb_array_length(CASE WHEN jsonb_typeof(settings->'queries')='array' THEN settings->'queries' ELSE '[]'::jsonb END)>0";
const LANES = Object.freeze({
  history: Object.freeze({ checkpoint: 'checkpoint', progress: 'progress', nextCheckAt: 'next_check_at' }),
  fresh: Object.freeze({ checkpoint: 'fresh_checkpoint', progress: 'fresh_progress', nextCheckAt: 'fresh_next_check_at' }),
  reconcile: Object.freeze({ checkpoint: 'reconciliation_checkpoint', progress: 'reconciliation_progress', nextCheckAt: 'reconciliation_next_check_at' }),
});

class JobSearchRepository {
  constructor(pool, { defaults = {}, accessService = null, lane = 'history' } = {}) {
    if (!Object.hasOwn(LANES, lane)) throw jobError('JOB_INVALID_SEARCH');
    this.pool = pool; this.defaults = defaults; this.accessService = accessService;
    this.lane = lane; this.columns = LANES[lane];
  }

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
    settings = parseJobSettings(settings);
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      const row = (await client.query(`UPDATE job_searches SET settings=$1,revision=revision+1,
        checkpoint=CASE WHEN settings->'queries' IS DISTINCT FROM $1::jsonb->'queries' THEN NULL ELSE checkpoint END,
        fresh_checkpoint=NULL,fresh_progress=NULL,fresh_next_check_at=now(),
        reconciliation_checkpoint=NULL,reconciliation_progress=NULL,reconciliation_next_check_at=now()+interval '1 day',
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
        fresh_next_check_at=CASE WHEN $1::boolean THEN now() ELSE fresh_next_check_at END,
        reconciliation_next_check_at=CASE WHEN $1::boolean THEN LEAST(reconciliation_next_check_at,now()+interval '1 day') ELSE reconciliation_next_check_at END,
        lease_id=NULL,lease_until=NULL,status='idle',failure_code=NULL,updated_at=now()
        WHERE user_id=$4 AND revision=$5
        AND (NOT $1::boolean OR ${HAS_QUERIES_SQL})
        AND (settings->>'activated' IS DISTINCT FROM ($1::boolean)::text OR settings->>'paused' IS DISTINCT FROM (NOT $1::boolean)::text)
        RETURNING *`, [enabled, scope.conversationId, scope.chatId, scope.userId, expectedRevision])).rows[0];
      if (row) return row;
      const current = (await client.query('SELECT * FROM job_searches WHERE user_id=$1', [scope.userId])).rows[0];
      if (enabled && !current?.settings?.queries?.length) throw jobError('JOB_SEARCH_QUERIES_REQUIRED');
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

  async matchedVacancies({ userId, externalIds, filterRevision, publishedFrom, publishedTo }) {
    uuid.parse(userId);
    if (!Array.isArray(externalIds) || externalIds.length > 1000
      || !externalIds.every((id) => typeof id === 'string' && /^\d{1,20}$/.test(id))
      || !Number.isInteger(filterRevision) || filterRevision < 1
      || ![publishedFrom, publishedTo].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value)
      || publishedFrom > publishedTo) throw jobError('JOB_INVALID_VACANCY');
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      if (!externalIds.length) return new Map();
      const rows = (await client.query(`SELECT v.external_id,v.id FROM job_matches m
        JOIN job_vacancies v ON v.id=m.vacancy_id
        WHERE m.user_id=$1 AND m.filter_revision=$2 AND v.source='hh' AND v.external_id=ANY($3::text[])
          AND v.published_at BETWEEN $4::timestamptz AND $5::timestamptz
          AND EXISTS(SELECT 1 FROM job_deliveries d WHERE d.user_id=m.user_id AND d.vacancy_id=m.vacancy_id
            AND d.kind='card' AND d.status IN ('sent','sending','unknown'))`,
      [userId, filterRevision, externalIds, publishedFrom, publishedTo])).rows;
      return new Map(rows.map((row) => [row.external_id, row.id]));
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
    const { nextCheckAt, checkpoint, progress } = this.columns;
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      const row = (await client.query(`UPDATE job_searches SET lease_id=$1,lease_until=$2::timestamptz+interval '5 minutes',
        status='collecting' WHERE user_id=$3 AND (lease_until IS NULL OR lease_until<$2)
        AND settings->>'activated'='true' AND settings->>'paused'='false'
        AND ${HAS_QUERIES_SQL}
        AND ($4::boolean OR ${nextCheckAt}<=$2) RETURNING *`, [leaseId, now, uuid.parse(userId), force])).rows[0] || null;
      return row && this.lane !== 'history'
        ? { ...row, checkpoint: row[checkpoint],
          progress: this.lane === 'reconcile' && row[progress]?.cycleFinished === true ? null : row[progress],
          next_check_at: row[nextCheckAt] } : row;
    });
  }

  async finishSearch({ userId, leaseId, checkpoint, nextCheckAt, failureCode = null }) {
    const { checkpoint: checkpointColumn, progress, nextCheckAt: nextCheckColumn } = this.columns;
    return jobTransaction(this.pool, async (client) => {
      try { await assertUserJobAccess(client, this.accessService, userId); } catch { return false; }
      return (await client.query(`UPDATE job_searches SET ${checkpointColumn}=COALESCE($1,${checkpointColumn}),${nextCheckColumn}=$2,
        ${progress}=CASE WHEN $1::timestamptz IS NOT NULL THEN NULL ELSE ${progress} END,
        lease_id=NULL,lease_until=NULL,status=$3,failure_code=$4,updated_at=now()
        WHERE user_id=$5 AND lease_id=$6 RETURNING id`, [checkpoint, nextCheckAt,
        failureCode ? 'attention' : 'idle', failureCode, userId, leaseId])).rowCount === 1;
    });
  }

  async saveProgress({ userId, leaseId, progress }) {
    if (Buffer.byteLength(JSON.stringify(progress)) > 128 * 1024) throw jobError('JOB_COLLECTION_LIMIT');
    return jobTransaction(this.pool, async (client) => {
      await assertUserJobAccess(client, this.accessService, userId);
      const row = await client.query(`UPDATE job_searches SET ${this.columns.progress}=$1 WHERE user_id=$2 AND lease_id=$3 RETURNING id`, [progress, userId, leaseId]);
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

  async dueUsers({ now = new Date(), limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw jobError('JOB_INVALID_SEARCH');
    const allowed = [];
    let cursor = null;
    // Advance past revoked searches as well: they retain their settings and must
    // not permanently occupy the first page ahead of users who still have access.
    while (allowed.length < limit) {
      // Keep PostgreSQL's full timestamp precision in the pagination cursor.
      const candidates = (await this.pool.query(`SELECT user_id,${this.columns.nextCheckAt}::text AS due_at FROM job_searches WHERE ${this.columns.nextCheckAt}<=$1
        AND (lease_until IS NULL OR lease_until<$1)
        AND settings->>'activated'='true' AND settings->>'paused'='false'
        AND ${HAS_QUERIES_SQL}
        AND ($2::timestamptz IS NULL OR (${this.columns.nextCheckAt},user_id)>($2::timestamptz,$3::uuid))
        ORDER BY ${this.columns.nextCheckAt},user_id LIMIT 100`, [now, cursor?.due_at || null, cursor?.user_id || null])).rows;
      for (const row of candidates) {
        try { await assertUserJobAccess(this.pool, this.accessService, row.user_id); allowed.push({ user_id: row.user_id }); }
        catch (error) {
          // Permission revocation is expected; database failures must reach the worker log.
          if (error.code !== 'JOB_SCOPE_DENIED') throw error;
        }
        if (allowed.length === limit) break;
      }
      if (candidates.length < 100) break;
      cursor = candidates[candidates.length - 1];
    }
    return allowed;
  }
}

module.exports = { JobSearchRepository };
