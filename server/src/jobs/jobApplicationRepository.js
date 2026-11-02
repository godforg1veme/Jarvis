const crypto = require('node:crypto');
const { uuid, assertJobScope, jobError } = require('./jobSchemas');
const { jobTransaction } = require('./jobTransaction');
const { normalizeQuestionnaire, normalizeAnswers } = require('../../../shared/jobQuestionnaire');

class JobApplicationRepository {
  constructor(pool, { now = () => new Date(), accessService = null } = {}) { this.pool = pool; this.now = now; this.accessService = accessService; }
  async snapshot(client, { scope, draftId }) {
    const row = (await client.query(`SELECT d.*,v.external_id,v.snapshot,v.revision AS latest_vacancy_revision,
      p.revision AS latest_profile_revision,
      m.hidden AS match_hidden,m.filter_revision AS match_filter_revision,
      c.resume_id AS selected_resume_id,c.revision AS selected_connection_revision,c.status AS connection_status
      FROM job_drafts d JOIN job_vacancies v ON v.id=d.vacancy_id
      JOIN job_matches m ON m.vacancy_id=v.id AND m.user_id=d.user_id
      JOIN job_profiles p ON p.user_id=d.user_id JOIN job_connections c ON c.user_id=d.user_id
      WHERE d.id=$1 AND d.user_id=$2 AND d.current
      FOR SHARE OF v,p,c,m`, [uuid.parse(draftId), scope.userId])).rows[0];
    if (!row) throw jobError('JOB_NOT_FOUND');
    if (row.profile_revision !== row.latest_profile_revision || row.vacancy_revision !== row.latest_vacancy_revision) throw jobError('JOB_REVISION_CONFLICT');
    if (row.connection_status !== 'connected' || !row.selected_resume_id) throw jobError('JOB_HH_NOT_CONNECTED');
    if (!row.resume_id || !row.connection_revision || row.resume_id !== row.selected_resume_id
      || row.connection_revision !== row.selected_connection_revision) throw jobError('JOB_DRAFT_RESUME_STALE');
    return row;
  }
  async prepare({ scope, draftId }) {
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
      const row = await this.snapshot(client, { scope, draftId });
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-draft:${scope.userId}:${row.vacancy_id}`]);
      if (!(await client.query('SELECT id FROM job_drafts WHERE id=$1 AND current', [row.id])).rowCount) throw jobError('JOB_REVISION_CONFLICT');
      const frozen = { vacancyId: row.vacancy_id, externalId: row.external_id, draftId: row.id,
        profileRevision: row.profile_revision, vacancyRevision: row.vacancy_revision,
        connectionRevision: row.connection_revision, resumeId: row.resume_id, text: row.text,
        company: row.snapshot.company || '', title: row.snapshot.title, url: row.snapshot.url };
      await client.query("UPDATE job_confirmations SET status='stale' WHERE user_id=$1 AND kind='apply' AND status='pending'", [scope.userId]);
      return (await client.query(`INSERT INTO job_confirmations(user_id,conversation_id,chat_id,channel,kind,target_id,frozen,expires_at)
        VALUES($1,$2,$3,'telegram','apply',$4,$5,$6) RETURNING *`, [scope.userId, scope.conversationId, scope.chatId,
        draftId, frozen, new Date(this.now().getTime() + 600000)])).rows[0];
    });
  }
  async getConfirmation({ scope, confirmationId }) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query(`SELECT * FROM job_confirmations WHERE id=$1 AND user_id=$2
      AND conversation_id=$3 AND chat_id=$4 AND channel='telegram' AND kind='apply'`,
    [uuid.parse(confirmationId), scope.userId, scope.conversationId, scope.chatId])).rows[0] || null;
  }
  async claim({ scope, confirmationId }) {
    return jobTransaction(this.pool, async (client) => {
      await assertJobScope(client, scope, this.accessService);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
      const confirmation = (await client.query(`SELECT * FROM job_confirmations WHERE id=$1 AND user_id=$2
        AND conversation_id=$3 AND chat_id=$4 AND channel='telegram' AND kind='apply' FOR UPDATE`,
      [uuid.parse(confirmationId), scope.userId, scope.conversationId, scope.chatId])).rows[0];
      if (!confirmation) throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
      if (confirmation.status === 'consumed') {
        const previous = (await client.query('SELECT * FROM job_applications WHERE confirmation_id=$1 AND user_id=$2', [confirmation.id, scope.userId])).rows[0];
        if (previous) return { operation: previous, execute: false };
      }
      if (confirmation.status !== 'pending' || new Date(confirmation.expires_at) <= this.now()) throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
      const frozen = confirmation.frozen;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-draft:${scope.userId}:${frozen.vacancyId}`]);
      const row = await this.snapshot(client, { scope, draftId: frozen.draftId });
      if (row.resume_id !== frozen.resumeId || row.connection_revision !== frozen.connectionRevision
        || row.profile_revision !== frozen.profileRevision || row.vacancy_revision !== frozen.vacancyRevision
        || row.text !== frozen.text) throw jobError('JOB_REVISION_CONFLICT');
      const existing = (await client.query(`SELECT * FROM job_applications WHERE user_id=$1 AND vacancy_id=$2
        AND (resume_id=$3 OR status IN ('sending','unknown')) ORDER BY created_at LIMIT 1`,
        [scope.userId, row.vacancy_id, row.resume_id])).rows[0];
      if (existing) return { operation: existing, execute: false };
      const operation = (await client.query(`INSERT INTO job_applications(user_id,vacancy_id,resume_id,draft_id,
        confirmation_id,operation_id,approved_text,status) VALUES($1,$2,$3,$4,$5,$6,$7,'sending') RETURNING *`,
      [scope.userId, row.vacancy_id, row.resume_id, row.id, confirmation.id, crypto.randomUUID(), row.text])).rows[0];
      await client.query("UPDATE job_confirmations SET status='consumed' WHERE id=$1", [confirmation.id]);
      return { operation, execute: true };
    });
  }
  async claimAutomatic({ scope, draftId, automationRevision, expectedSearchRevision = null, questionnaire = null, answers = null, questionnaireContext = null }) {
    if (!Number.isInteger(automationRevision) || automationRevision < 1) throw jobError('JOB_AUTOMATION_UNAVAILABLE');
    if (questionnaire !== null) {
      questionnaire = normalizeQuestionnaire(questionnaire);
      answers = normalizeAnswers(questionnaire, answers);
      if (!questionnaireContext || questionnaireContext.automationRevision !== automationRevision) throw jobError('JOB_REVISION_CONFLICT');
    } else if (answers !== null || questionnaireContext !== null) throw jobError('JOB_INVALID_APPLICATION_RESULT');
    return jobTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))");
      await assertJobScope(client, scope, this.accessService);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-owner:${scope.userId}`]);
      const consent = (await client.query(`SELECT a.* FROM job_automations a
        JOIN job_searches s ON s.user_id=a.user_id
        JOIN job_connections c ON c.user_id=a.user_id
        WHERE a.user_id=$1 AND a.enabled AND a.revision=$2
          AND a.conversation_id=$3 AND a.chat_id=$4
          AND c.status='connected' AND c.resume_id=a.resume_id AND c.revision=a.connection_revision
          AND s.conversation_id=a.conversation_id AND s.chat_id=a.chat_id
          AND s.settings->>'activated'='true' AND s.settings->>'paused'='false' FOR SHARE OF a,c,s`,
      [scope.userId, automationRevision, scope.conversationId, scope.chatId])).rows[0];
      if (!consent) throw jobError('JOB_AUTOMATION_UNAVAILABLE');
      const row = await this.snapshot(client, { scope, draftId });
      if (row.resume_id !== consent.resume_id || row.connection_revision !== consent.connection_revision)
        throw jobError('JOB_AUTOMATION_UNAVAILABLE');
      const search = (await client.query('SELECT revision FROM job_searches WHERE user_id=$1', [scope.userId])).rows[0];
      if (row.match_hidden || row.match_filter_revision !== search?.revision)
        throw jobError('JOB_REVISION_CONFLICT');
      if (expectedSearchRevision !== null && search.revision !== expectedSearchRevision) throw jobError('JOB_REVISION_CONFLICT');
      if (questionnaireContext && (questionnaireContext.profileRevision !== row.profile_revision
        || questionnaireContext.vacancyRevision !== row.vacancy_revision || questionnaireContext.searchRevision !== search.revision
        || questionnaireContext.resumeId !== row.resume_id || questionnaireContext.connectionRevision !== row.connection_revision))
        throw jobError('JOB_REVISION_CONFLICT');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`job-draft:${scope.userId}:${row.vacancy_id}`]);
      const existing = (await client.query(`SELECT * FROM job_applications WHERE user_id=$1 AND vacancy_id=$2
        AND (resume_id=$3 OR status IN ('sending','unknown')) ORDER BY created_at LIMIT 1`,
      [scope.userId, row.vacancy_id, row.resume_id])).rows[0];
      if (existing) return { operation: existing, execute: false };
      const operation = (await client.query(`INSERT INTO job_applications(user_id,vacancy_id,resume_id,draft_id,
        confirmation_id,automation_revision,operation_id,approved_text,status,questionnaire,questionnaire_answers,questionnaire_context)
        VALUES($1,$2,$3,$4,NULL,$5,$6,$7,'sending',$8,$9,$10) RETURNING *`,
      [scope.userId,row.vacancy_id,row.resume_id,row.id,automationRevision,crypto.randomUUID(),row.text,
        questionnaire, answers === null ? null : JSON.stringify(answers), questionnaireContext])).rows[0];
      return { operation, execute: true };
    });
  }
  async findAutomaticForDraft({ scope, draftId }) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query(`SELECT a.* FROM job_applications a JOIN job_drafts d
      ON d.user_id=a.user_id AND d.vacancy_id=a.vacancy_id
      WHERE d.id=$1 AND d.user_id=$2 AND (a.resume_id=d.resume_id OR a.status IN ('sending','unknown'))
      ORDER BY a.created_at LIMIT 1`, [uuid.parse(draftId), scope.userId])).rows[0] || null;
  }
  async get({ scope, operationId }) {
    await assertJobScope(this.pool, scope, this.accessService);
    return (await this.pool.query(`SELECT a.*,v.external_id AS vacancy_external_id,v.snapshot FROM job_applications a
      JOIN job_vacancies v ON v.id=a.vacancy_id WHERE a.user_id=$1 AND a.operation_id=$2`,
    [scope.userId, uuid.parse(operationId)])).rows[0] || null;
  }
  async finish({ userId, operationId, status, externalId = null, failureCode = null }) {
    if (!['sent', 'failed', 'unknown', 'manual_required', 'already_applied'].includes(status)) throw jobError('JOB_INVALID_APPLICATION_STATUS');
    if (externalId != null && (typeof externalId !== 'string' || !/^[\w-]{1,128}$/.test(externalId))) throw jobError('JOB_INVALID_APPLICATION_RESULT');
    if (failureCode != null && !/^JOB_[A-Z_]{1,70}$/.test(failureCode)) throw jobError('JOB_INVALID_APPLICATION_RESULT');
    return (await this.pool.query(`UPDATE job_applications SET status=$1,external_id=COALESCE($2,external_id),
      failure_code=$3,updated_at=now() WHERE user_id=$4 AND operation_id=$5 AND status IN ('sending','unknown') RETURNING *`,
    [status, externalId, failureCode, uuid.parse(userId), uuid.parse(operationId)])).rows[0] || null;
  }
  async recoverSending() {
    return (await this.pool.query(`UPDATE job_applications SET status='unknown',failure_code='JOB_SUBMISSION_INTERRUPTED',updated_at=now()
      WHERE status='sending' AND updated_at<now()-interval '2 minutes' RETURNING operation_id`)).rows;
  }
}
module.exports = { JobApplicationRepository };
