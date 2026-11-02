const crypto = require('node:crypto');
const { uuid, assertJobScope, assertUserJobAccess, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');
const { moscowIso } = require('../../../shared/time');
const { normalizeStopReason } = require('./jobStopReasons');

class JobAutomationRepository {
  constructor(pool, { accessService = null } = {}) { this.pool = pool; this.accessService = accessService; }

  async get({ scope }) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query('SELECT * FROM job_automations WHERE user_id=$1', [scope.userId])).rows[0] || null;
  }

  async setEnabled({ scope, enabled, expectedRevision, resumeId = null, connectionRevision = null }) {
    if (typeof enabled !== 'boolean' || !Number.isInteger(expectedRevision) || expectedRevision < 0)
      throw jobError('JOB_INVALID_SETTINGS_INPUT');
    return jobTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
      await assertJobScope(client, scope, this.accessService);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
      await client.query('INSERT INTO job_automations(user_id) VALUES($1) ON CONFLICT DO NOTHING', [scope.userId]);
      const current = (await client.query('SELECT * FROM job_automations WHERE user_id=$1 FOR UPDATE', [scope.userId])).rows[0];
      if (current.revision !== expectedRevision) throw jobError('JOB_REVISION_CONFLICT');
      if (!enabled && !current.enabled) return current;
      if (enabled) {
        const connection = (await client.query('SELECT resume_id,revision,status FROM job_connections WHERE user_id=$1 FOR SHARE', [scope.userId])).rows[0];
        const search = (await client.query('SELECT settings,conversation_id,chat_id FROM job_searches WHERE user_id=$1 FOR UPDATE', [scope.userId])).rows[0];
        if (!connection || connection.status !== 'connected' || connection.resume_id !== resumeId
          || connection.revision !== connectionRevision || !search?.settings?.activated || search.settings.paused)
          throw jobError('JOB_AUTOMATION_UNAVAILABLE');
        if (current.enabled && current.resume_id === resumeId && current.connection_revision === connectionRevision
          && current.conversation_id === scope.conversationId && current.chat_id === scope.chatId
          && search.conversation_id === scope.conversationId && search.chat_id === scope.chatId) return current;
        if (search.conversation_id !== scope.conversationId || search.chat_id !== scope.chatId)
          await client.query('UPDATE job_searches SET conversation_id=$2,chat_id=$3 WHERE user_id=$1',
            [scope.userId,scope.conversationId,scope.chatId]);
      }
      return (await client.query(`UPDATE job_automations SET enabled=$2,revision=revision+1,
        resume_id=$3,connection_revision=$4,conversation_id=$5,chat_id=$6,
        next_attempt_at=now(),updated_at=now()
        WHERE user_id=$1 RETURNING *`, [scope.userId, enabled, enabled ? resumeId : null,
        enabled ? connectionRevision : null, enabled ? scope.conversationId : null,
        enabled ? scope.chatId : null])).rows[0];
    });
  }

  async assertCurrent({ scope, revision, resumeId = null, connectionRevision = null, client = this.pool }) {
    await assertJobScope(client, scope, this.accessService);
    const row = (await client.query(`SELECT a.* FROM job_automations a
      JOIN job_connections c ON c.user_id=a.user_id
      JOIN job_searches s ON s.user_id=a.user_id
      WHERE a.user_id=$1 AND a.enabled AND a.revision=$2
        AND a.conversation_id=$3 AND a.chat_id=$4
        AND c.status='connected' AND c.resume_id=a.resume_id AND c.revision=a.connection_revision
        AND s.conversation_id=a.conversation_id AND s.chat_id=a.chat_id
        AND s.settings->>'activated'='true' AND s.settings->>'paused'='false'`,
    [scope.userId, revision, scope.conversationId, scope.chatId])).rows[0];
    if (!row || (resumeId !== null && row.resume_id !== resumeId)
      || (connectionRevision !== null && row.connection_revision !== connectionRevision))
      throw jobError('JOB_AUTOMATION_UNAVAILABLE');
    return row;
  }

  async claimCandidate() {
    return jobTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
      const rows = (await client.query(`SELECT a.user_id,a.revision,a.conversation_id,a.chat_id,
          m.vacancy_id, i.id AS item_id
        FROM job_automations a JOIN job_searches s ON s.user_id=a.user_id
        JOIN job_connections c ON c.user_id=a.user_id
        JOIN job_matches m ON m.user_id=a.user_id AND NOT m.hidden AND m.filter_revision=s.revision
        LEFT JOIN job_automation_items i ON i.user_id=a.user_id AND i.vacancy_id=m.vacancy_id
          AND i.automation_revision=a.revision
        WHERE a.enabled AND a.conversation_id=s.conversation_id AND a.chat_id=s.chat_id
          AND c.status='connected' AND c.resume_id=a.resume_id AND c.revision=a.connection_revision
          AND s.settings->>'activated'='true' AND s.settings->>'paused'='false'
          AND a.next_attempt_at<=now()
          AND (i.id IS NULL OR i.status='pending' OR (i.status='skipped'
            AND i.evaluation->>'decision'='skip'
            AND i.evaluation->>'source' IN ('filter','model')
            AND (i.evaluation->'revisions'->>'search') ~ '^[0-9]+$'
            AND (i.evaluation->'revisions'->>'search')::integer < s.revision
            AND i.draft_id IS NULL AND i.operation_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM job_drafts d WHERE d.user_id=i.user_id AND d.vacancy_id=i.vacancy_id)
            AND NOT EXISTS (SELECT 1 FROM job_applications app WHERE app.user_id=i.user_id AND app.vacancy_id=i.vacancy_id)))
          AND NOT EXISTS (SELECT 1 FROM job_automation_items old
            WHERE old.user_id=a.user_id AND old.vacancy_id=m.vacancy_id
              AND old.status IN ('evaluating','generating','submitting','unknown'))
        ORDER BY m.created_at DESC,m.id LIMIT 50 FOR UPDATE OF a SKIP LOCKED`)).rows;
      for (const candidate of rows) {
        try { await assertUserJobAccess(client, this.accessService, candidate.user_id); }
        catch { continue; }
        const id = candidate.item_id || crypto.randomUUID();
        const item = candidate.item_id
          ? (await client.query(`UPDATE job_automation_items i SET status='evaluating',
               evaluation_request_id=CASE WHEN i.status='skipped' THEN $2 ELSE i.evaluation_request_id END,
               updated_at=now()
             FROM job_searches s WHERE i.id=$1 AND s.user_id=i.user_id
               AND (i.status='pending' OR (i.status='skipped'
                 AND i.evaluation->>'decision'='skip'
                 AND i.evaluation->>'source' IN ('filter','model')
                 AND (i.evaluation->'revisions'->>'search') ~ '^[0-9]+$'
                 AND (i.evaluation->'revisions'->>'search')::integer < s.revision
                 AND i.draft_id IS NULL AND i.operation_id IS NULL
                 AND NOT EXISTS (SELECT 1 FROM job_drafts d WHERE d.user_id=i.user_id AND d.vacancy_id=i.vacancy_id)
                 AND NOT EXISTS (SELECT 1 FROM job_applications app WHERE app.user_id=i.user_id AND app.vacancy_id=i.vacancy_id)))
             RETURNING i.*`, [id, `auto-evaluate:${id}:${crypto.randomUUID()}`])).rows[0]
          : (await client.query(`INSERT INTO job_automation_items
             (id,user_id,vacancy_id,automation_revision,status,evaluation_request_id,draft_request_id)
             VALUES($1,$2,$3,$4,'evaluating',$5,$6)
             ON CONFLICT(user_id,vacancy_id,automation_revision) DO NOTHING RETURNING *`,
             [id, candidate.user_id, candidate.vacancy_id, candidate.revision,
               `auto-evaluate:${id}`, `auto-letter:${id}`])).rows[0];
        if (item) return { ...item, conversation_id: candidate.conversation_id, chat_id: candidate.chat_id };
      }
      return null;
    });
  }

  async recoverInterrupted() {
    const rows = (await this.pool.query(`WITH stale AS (
      SELECT id FROM job_automation_items WHERE status IN ('evaluating','generating','submitting')
        AND updated_at<now()-interval '10 minutes'
      ORDER BY updated_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
    ), changed AS (
      UPDATE job_automation_items i SET status='unknown',updated_at=now()
      FROM stale WHERE i.id=stale.id RETURNING i.*
    ) SELECT i.*,a.conversation_id,a.chat_id,app.operation_id AS known_operation_id
      FROM changed i JOIN job_automations a ON a.user_id=i.user_id
        AND a.revision=i.automation_revision AND a.enabled
      LEFT JOIN LATERAL (SELECT operation_id FROM job_applications
        WHERE user_id=i.user_id AND vacancy_id=i.vacancy_id
          AND automation_revision=i.automation_revision
        ORDER BY created_at DESC LIMIT 1) app ON true`)).rows;
    return rows;
  }

  async claimPrerequisites() {
    return (await this.pool.query(`WITH pending AS (
      SELECT a.user_id FROM job_automations a
      JOIN job_searches s ON s.user_id=a.user_id
      LEFT JOIN job_connections c ON c.user_id=a.user_id
      WHERE a.enabled AND a.next_attempt_at<=now()
        AND s.settings->>'activated'='true' AND s.settings->>'paused'='false'
        AND (c.status IS DISTINCT FROM 'connected' OR c.resume_id IS DISTINCT FROM a.resume_id
          OR c.revision IS DISTINCT FROM a.connection_revision)
      ORDER BY a.updated_at,a.user_id LIMIT 20 FOR UPDATE OF a SKIP LOCKED
    ), changed AS (
      UPDATE job_automations a SET next_attempt_at=now()+interval '15 minutes'
      FROM pending p WHERE a.user_id=p.user_id RETURNING a.*
    ) SELECT a.*,CASE WHEN c.status IS DISTINCT FROM 'connected'
      THEN 'LOGIN_REQUIRED' ELSE 'RESUME_UNAVAILABLE' END AS code
      FROM changed a LEFT JOIN job_connections c ON c.user_id=a.user_id`)).rows;
  }

  async resolveUnknown({ itemId, status, operationId = null }) {
    if (!['sent','manual_required','failed'].includes(status)) throw jobError('JOB_INVALID_ACTION');
    return (await this.pool.query(`UPDATE job_automation_items SET status=$2,
      operation_id=COALESCE($3,operation_id),updated_at=now() WHERE id=$1 AND status='unknown' RETURNING *`,
    [uuid.parse(itemId),status,operationId])).rows[0] || null;
  }

  async update({ itemId, status, from, draftId = null, operationId = null }) {
    if (!['pending','skipped','generating','submitting','sent','manual_required','unknown','failed'].includes(status)
      || !['evaluating','generating','submitting'].includes(from)) throw jobError('JOB_INVALID_ACTION');
    return (await this.pool.query(`UPDATE job_automation_items SET status=$2,
      draft_id=COALESCE($3,draft_id),operation_id=COALESCE($4,operation_id),updated_at=now()
      WHERE id=$1 AND status=$5 RETURNING *`, [uuid.parse(itemId), status, draftId, operationId, from])).rows[0] || null;
  }
  async saveEvaluation({ itemId, evaluation }) {
    if (!evaluation || typeof evaluation !== 'object' || JSON.stringify(evaluation).length > 4000)
      throw jobError('JOB_MODEL_INVALID_OUTPUT');
    const row = (await this.pool.query(`UPDATE job_automation_items SET evaluation=$2::jsonb,updated_at=now()
      WHERE id=$1 AND status='evaluating' RETURNING id`, [uuid.parse(itemId), evaluation])).rows[0];
    if (!row) throw jobError('JOB_REVISION_CONFLICT');
    return row;
  }

  async finalizeKnownSkip({ itemId, evaluatedSearchRevision }) {
    return jobTransaction(this.pool, async client => {
      const row = (await client.query(`SELECT i.id,i.evaluation,s.revision AS search_revision
        FROM job_automation_items i JOIN job_searches s ON s.user_id=i.user_id
        WHERE i.id=$1 AND i.status='evaluating' FOR UPDATE OF i,s`, [uuid.parse(itemId)])).rows[0];
      if (!row || row.evaluation?.decision !== 'skip'
        || row.evaluation?.revisions?.search !== evaluatedSearchRevision) throw jobError('JOB_REVISION_CONFLICT');
      await client.query("UPDATE job_automation_items SET status='skipped',updated_at=now() WHERE id=$1", [itemId]);
      return { searchRevisionChanged: row.search_revision !== evaluatedSearchRevision };
    });
  }

  async enqueueAttention({ scope, vacancyId, automationRevision, code, reasonCode = null }) {
    if (!['MANUAL_REQUIRED','LOGIN_REQUIRED','RESULT_UNKNOWN','PROCESSING_UNKNOWN','MODEL_UNAVAILABLE','RESUME_UNAVAILABLE'].includes(code)) throw jobError('JOB_INVALID_ACTION');
    // A lost HH connection still needs a private handover. Bind the notice to
    // the original consent/chat, while the delivery worker rechecks access.
    await assertJobScope(this.pool, scope, this.accessService);
    const consent = (await this.pool.query(`SELECT 1 FROM job_automations
      WHERE user_id=$1 AND enabled AND revision=$2 AND conversation_id=$3 AND chat_id=$4`,
      [scope.userId, automationRevision, scope.conversationId, scope.chatId])).rowCount;
    if (!consent) throw jobError('JOB_AUTOMATION_UNAVAILABLE');
    const kind = code === 'MANUAL_REQUIRED' ? 'HH_AUTO_MANUAL' : 'HH_AUTO_ATTENTION';
    return (await this.pool.query(`INSERT INTO job_deliveries(user_id,vacancy_id,kind,dedup_key,payload)
      SELECT $1::uuid,$2::uuid,'attention',$3,jsonb_build_object('reason',$4::text,'code',$5::text,
        'vacancyId',($2::uuid)::text,'conversationId',$6::text,'chatId',$7::text,
        'automationRevision',$8::integer,'failureCode',$9::text)
      WHERE ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM job_matches WHERE user_id=$1 AND vacancy_id=$2::uuid))
      ON CONFLICT(user_id,dedup_key) DO NOTHING RETURNING id`, [scope.userId, vacancyId,
      `attention:auto:${code}:${['MODEL_UNAVAILABLE','RESUME_UNAVAILABLE','LOGIN_REQUIRED'].includes(code)
        ? moscowIso().slice(0,10) : vacancyId || 'system'}:${automationRevision}`, kind, code,
      scope.conversationId, scope.chatId, automationRevision,
      code === 'MANUAL_REQUIRED' && reasonCode ? normalizeStopReason(reasonCode) : null])).rows[0] || null;
  }

  async backoff({ scope, automationRevision, minutes = 15 }) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw jobError('JOB_INVALID_ACTION');
    await assertJobScope(this.pool, scope, this.accessService);
    await this.pool.query(`UPDATE job_automations SET next_attempt_at=GREATEST(next_attempt_at,now()+($4::int*interval '1 minute'))
      WHERE user_id=$1 AND revision=$2 AND enabled AND conversation_id=$3 AND chat_id=$5`,
    [scope.userId,automationRevision,scope.conversationId,minutes,scope.chatId]);
  }
}

module.exports = { JobAutomationRepository };
