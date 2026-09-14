const { randomUUID } = require('node:crypto');
const {
  createAreaSchema,
  createCommitmentSchema,
  createProjectSchema,
  createProposalSchema,
  feedbackInputSchema,
  lifeEventLinkInputSchema,
  updateProjectSchema,
} = require('./lifeSchemas');

const TARGET_TABLES = Object.freeze({
  area: 'life_areas',
  project: 'life_projects',
  conversation: 'conversations',
  document: 'documents',
  device: 'devices',
  workflow: 'action_workflows',
  commitment: 'life_commitments',
  proposal: 'life_proposals',
  event: 'life_events',
  link: 'life_event_links',
  memory: 'memories',
  person: 'life_people',
  reminder: 'life_reminders',
  recovery_plan: 'life_recovery_plans',
  source_connection: 'life_source_connections',
  mode: 'life_modes',
  preference: 'life_preferences',
});

const DEFAULT_AREAS = Object.freeze([
  ['work', 'Работа', 10],
  ['family', 'Семья', 20],
  ['home', 'Дом', 30],
  ['health', 'Здоровье', 40],
  ['finance', 'Финансы', 50],
  ['development', 'Развитие', 60],
]);

class LifeProjectionRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureDefaultAreas({ userId }) {
    const result = await this.pool.query(`
      INSERT INTO life_areas (user_id, area_key, name, sort_order)
      SELECT $1, seed.area_key, seed.name, seed.sort_order
      FROM jsonb_to_recordset($2::jsonb) AS seed(area_key text, name text, sort_order integer)
      ON CONFLICT (user_id, area_key) DO UPDATE SET area_key = EXCLUDED.area_key
      RETURNING *
    `, [userId, JSON.stringify(DEFAULT_AREAS.map(([areaKey, name, sortOrder]) => ({ area_key: areaKey, name, sort_order: sortOrder })))]);
    return result.rows;
  }

  async listAreas({ userId, includeArchived = false }) {
    const result = await this.pool.query(`
      SELECT id, area_key, name, status, sort_order, revision, created_at, updated_at
      FROM life_areas
      WHERE user_id = $1 AND ($2 OR status = 'active')
      ORDER BY sort_order, created_at, id
    `, [userId, Boolean(includeArchived)]);
    return result.rows;
  }

  async getArea({ userId, areaId }) {
    const result = await this.pool.query(`
      SELECT id, area_key, name, status, sort_order, revision, created_at, updated_at
      FROM life_areas WHERE id = $1 AND user_id = $2
    `, [areaId, userId]);
    return result.rows[0] || null;
  }

  async createArea({ userId, ...raw }) {
    const input = createAreaSchema.parse(raw);
    const result = await this.pool.query(`
      INSERT INTO life_areas (user_id, area_key, name, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [userId, input.key || null, input.name, input.sortOrder]);
    return result.rows[0];
  }

  async createProject({ userId, ...raw }) {
    const input = createProjectSchema.parse(raw);
    const result = await this.pool.query(`
      INSERT INTO life_projects (user_id, area_id, name, summary, target_at)
      SELECT $1, $2, $3, $4, $5
      WHERE $2::uuid IS NULL OR EXISTS (
        SELECT 1 FROM life_areas WHERE id = $2 AND user_id = $1 AND status = 'active'
      )
      RETURNING *
    `, [userId, input.areaId || null, input.name, input.summary, input.targetAt ? new Date(input.targetAt) : null]);
    return result.rows[0] || null;
  }

  async getProject({ userId, projectId }) {
    const result = await this.pool.query(`
      SELECT * FROM life_projects WHERE id = $1 AND user_id = $2
    `, [projectId, userId]);
    return result.rows[0] || null;
  }

  async listProjects({ userId, statuses = ['active', 'paused'] }) {
    const allowed = statuses.filter((status) => ['active', 'paused', 'completed', 'archived'].includes(status)).slice(0, 4);
    if (allowed.length === 0) return [];
    const result = await this.pool.query(`
      SELECT * FROM life_projects
      WHERE user_id = $1 AND status = ANY($2::text[])
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC, id
    `, [userId, allowed]);
    return result.rows;
  }

  async updateProject({ userId, projectId, ...raw }) {
    const input = updateProjectSchema.parse(raw);
    const fields = [];
    const params = [projectId, userId, input.revision];
    const add = (column, value, cast = '') => {
      params.push(value);
      fields.push(`${column} = $${params.length}${cast}`);
    };
    if (input.name !== undefined) add('name', input.name);
    if (input.summary !== undefined) add('summary', input.summary);
    if (input.status !== undefined) add('status', input.status);
    if (input.targetAt !== undefined) add('target_at', input.targetAt ? new Date(input.targetAt) : null);
    let areaValidation = 'true';
    if (input.areaId !== undefined) {
      add('area_id', input.areaId || null, '::uuid');
      const areaParameter = params.length;
      areaValidation = `($${areaParameter}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM life_areas WHERE id = $${areaParameter}::uuid AND user_id = $2 AND status = 'active'
      ))`;
    }
    const result = await this.pool.query(`
      UPDATE life_projects
      SET ${fields.join(', ')}, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3
        AND (${areaValidation})
      RETURNING *
    `, params);
    return result.rows[0] || null;
  }

  async createLink(raw) {
    const input = lifeEventLinkInputSchema.parse(raw);
    const table = TARGET_TABLES[input.targetType];
    const result = await this.pool.query(`
      INSERT INTO life_event_links (
        user_id, event_id, target_type, target_id, relation_type, origin, confidence
      )
      SELECT $1, $2, $3, $4, $5, $6, $7
      WHERE EXISTS (SELECT 1 FROM life_events WHERE id = $2 AND user_id = $1)
        AND EXISTS (SELECT 1 FROM ${table} WHERE id = $4 AND user_id = $1)
      ON CONFLICT (user_id, event_id, target_type, target_id, relation_type)
      DO UPDATE SET origin = EXCLUDED.origin, confidence = EXCLUDED.confidence
      RETURNING *
    `, [input.userId, input.eventId, input.targetType, input.targetId,
      input.relationType, input.origin, input.confidence]);
    return result.rows[0] || null;
  }

  async createCommitment(raw) {
    const input = createCommitmentSchema.parse(raw);
    const result = await this.pool.query(`
      INSERT INTO life_commitments (
        user_id, source_event_id, area_id, project_id, person_id, kind, title,
        due_at, due_window_end_at, recurrence, external_source_ref, confidence
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12
      WHERE EXISTS (SELECT 1 FROM life_events WHERE id = $2 AND user_id = $1)
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM life_areas WHERE id = $3 AND user_id = $1))
        AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM life_projects WHERE id = $4 AND user_id = $1))
        AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM life_people WHERE id = $5 AND user_id = $1))
      ON CONFLICT (user_id, source_event_id) DO UPDATE
        SET source_event_id = EXCLUDED.source_event_id
      RETURNING *
    `, [input.userId, input.sourceEventId, input.areaId || null, input.projectId || null,
      input.personId || null, input.kind, input.title,
      input.dueAt ? new Date(input.dueAt) : null,
      input.dueWindowEndAt ? new Date(input.dueWindowEndAt) : null,
      input.recurrence ? JSON.stringify(input.recurrence) : null,
      input.externalSourceRef || null, input.confidence]);
    return result.rows[0] || null;
  }

  async createProposal(raw) {
    const input = createProposalSchema.parse(raw);
    const proposalId = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const evidence = await client.query(`
        SELECT id FROM life_events WHERE user_id = $1 AND id = ANY($2::uuid[])
      `, [input.userId, input.evidenceEventIds]);
      if (evidence.rows.length !== new Set(input.evidenceEventIds).size) {
        const error = new Error('proposal evidence is unavailable');
        error.publicCode = 'LIFE_EVIDENCE_UNAVAILABLE';
        throw error;
      }
      const result = await client.query(`
        INSERT INTO life_proposals (
          id, user_id, area_id, project_id, commitment_id, person_id, reminder_id,
          title, explanation, source_rule, source_rule_version, confidence,
          risk_class, action_name, action_arguments, origin_channel,
          origin_conversation_id, origin_device_id, cooldown_key, expires_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15::jsonb, $16, $17, $18, $19, $20
        WHERE ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM life_areas WHERE id = $3 AND user_id = $2))
          AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM life_projects WHERE id = $4 AND user_id = $2))
          AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM life_commitments WHERE id = $5 AND user_id = $2))
          AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM life_people WHERE id = $6 AND user_id = $2))
          AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM life_reminders WHERE id = $7 AND user_id = $2))
        RETURNING *
      `, [proposalId, input.userId, input.areaId || null, input.projectId || null,
        input.commitmentId || null, input.personId || null, input.reminderId || null,
        input.title, input.explanation, input.sourceRule, input.sourceRuleVersion,
        input.confidence, input.riskClass, input.actionName || null,
        JSON.stringify(input.actionArguments), input.originChannel,
        input.originConversationId || null, input.originDeviceId || null,
        input.cooldownKey, new Date(input.expiresAt)]);
      if (!result.rows[0]) throw new Error('proposal scope is unavailable');
      for (let position = 0; position < input.evidenceEventIds.length; position += 1) {
        await client.query(`
          INSERT INTO life_proposal_evidence (proposal_id, event_id, user_id, position)
          VALUES ($1, $2, $3, $4)
        `, [proposalId, input.evidenceEventIds[position], input.userId, position]);
      }
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordFeedback({ userId, ...raw }) {
    const input = feedbackInputSchema.parse(raw);
    const table = TARGET_TABLES[input.targetType];
    const result = await this.pool.query(`
      INSERT INTO life_feedback (user_id, kind, target_type, target_id, note)
      SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (SELECT 1 FROM ${table} WHERE id = $4 AND user_id = $1)
      RETURNING *
    `, [userId, input.kind, input.targetType, input.targetId, input.note]);
    return result.rows[0] || null;
  }

  async listTimeline({ userId, projectId = null, areaId = null, from = null, to = null, beforeOccurredAt = null, beforeId = null, limit = 40 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
    const result = await this.pool.query(`
      SELECT event.id, event.event_type, event.occurred_at, event.recorded_at,
             event.source_channel, event.summary, event.confidence,
             event.privacy_class, event.trust_level,
             COALESCE(jsonb_agg(jsonb_build_object(
               'id', link.id, 'targetType', link.target_type, 'targetId', link.target_id,
               'relationType', link.relation_type, 'origin', link.origin,
               'confidence', link.confidence
             ) ORDER BY link.created_at, link.id) FILTER (WHERE link.id IS NOT NULL), '[]'::jsonb) AS links
      FROM life_events event
      LEFT JOIN life_event_links link ON link.user_id = event.user_id AND link.event_id = event.id
        AND NOT EXISTS (
          SELECT 1 FROM life_feedback link_feedback
          WHERE link_feedback.user_id = link.user_id AND link_feedback.target_type = 'link'
            AND link_feedback.target_id = link.id AND link_feedback.kind IN ('incorrect_link', 'dismissed')
        )
        AND NOT (
          link.target_type = 'project' AND link.origin = 'inferred' AND EXISTS (
            SELECT 1 FROM life_feedback project_feedback
            WHERE project_feedback.user_id = event.user_id AND project_feedback.target_type = 'event'
              AND project_feedback.target_id = event.id AND project_feedback.kind = 'wrong_project'
          )
        )
      WHERE event.user_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM life_feedback event_feedback
          WHERE event_feedback.user_id = event.user_id AND event_feedback.target_type = 'event'
            AND event_feedback.target_id = event.id AND event_feedback.kind = 'dismissed'
        )
        AND ($2::uuid IS NULL OR EXISTS (
          SELECT 1 FROM life_event_links project_link
          WHERE project_link.user_id = event.user_id AND project_link.event_id = event.id
            AND project_link.target_type = 'project' AND project_link.target_id = $2
        ))
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM life_event_links area_link
          WHERE area_link.user_id = event.user_id AND area_link.event_id = event.id
            AND area_link.target_type = 'area' AND area_link.target_id = $3
        ))
        AND ($4::timestamptz IS NULL OR event.occurred_at >= $4)
        AND ($5::timestamptz IS NULL OR event.occurred_at <= $5)
        AND ($6::timestamptz IS NULL OR (event.occurred_at, event.id) < ($6::timestamptz, $7::uuid))
      GROUP BY event.id
      ORDER BY event.occurred_at DESC, event.id DESC
      LIMIT $8
    `, [userId, projectId, areaId, from ? new Date(from) : null, to ? new Date(to) : null,
      beforeOccurredAt, beforeId, boundedLimit]);
    return result.rows;
  }

  async listCommitments({ userId, projectId = null, statuses = ['open'], limit = 50 }) {
    const allowed = statuses.filter((status) => ['open', 'completed', 'dismissed', 'expired'].includes(status)).slice(0, 4);
    if (!allowed.length) return [];
    const result = await this.pool.query(`
      SELECT commitment.*, project.name AS project_name, area.name AS area_name
      FROM life_commitments commitment
      LEFT JOIN life_projects project ON project.id = commitment.project_id AND project.user_id = commitment.user_id
      LEFT JOIN life_areas area ON area.id = commitment.area_id AND area.user_id = commitment.user_id
      WHERE commitment.user_id = $1 AND commitment.status = ANY($2::text[])
        AND ($3::uuid IS NULL OR commitment.project_id = $3)
      ORDER BY commitment.due_at ASC NULLS LAST, commitment.created_at DESC, commitment.id
      LIMIT $4
    `, [userId, allowed, projectId, Math.min(Math.max(Number(limit) || 50, 1), 100)]);
    return result.rows;
  }

  async listDueCommitmentsForWorker({ dueBefore, limit = 100 }) {
    const result = await this.pool.query(`
      SELECT * FROM life_commitments
      WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= $1
      ORDER BY due_at, id LIMIT $2
    `, [dueBefore, Math.min(Math.max(Number(limit) || 100, 1), 100)]);
    return result.rows;
  }

  async listDormantProjectsForWorker({ inactiveBefore, limit = 50 }) {
    const result = await this.pool.query(`
      SELECT project.*, recent.id AS latest_event_id, recent.event_type AS latest_event_type,
             recent.summary AS latest_event_summary, recent.source_channel AS latest_source_channel,
             recent.source_device_id AS latest_source_device_id, recent.structured_data AS latest_structured_data,
             recent.occurred_at AS latest_occurred_at
      FROM life_projects project
      JOIN LATERAL (
        SELECT event.* FROM life_event_links link
        JOIN life_events event ON event.id = link.event_id AND event.user_id = link.user_id
        WHERE link.user_id = project.user_id AND link.target_type = 'project' AND link.target_id = project.id
        ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1
      ) recent ON true
      WHERE project.status = 'active' AND recent.occurred_at < $1
      ORDER BY recent.occurred_at, project.id LIMIT $2
    `, [inactiveBefore, Math.min(Math.max(Number(limit) || 50, 1), 50)]);
    return result.rows;
  }

  async getCommitment({ userId, commitmentId }) {
    const result = await this.pool.query(`
      SELECT * FROM life_commitments WHERE id = $1 AND user_id = $2
    `, [commitmentId, userId]);
    return result.rows[0] || null;
  }

  async updateCommitment({ userId, commitmentId, revision, status }) {
    const result = await this.pool.query(`
      UPDATE life_commitments
      SET status = $4, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3
      RETURNING *
    `, [commitmentId, userId, revision, status]);
    return result.rows[0] || null;
  }

  async listProposals({ userId, projectId = null, statuses = ['open'], limit = 30 }) {
    const allowed = statuses.filter((status) => [
      'open', 'confirmed', 'dismissed', 'expired', 'executing', 'completed', 'failed', 'outcome_unknown',
    ].includes(status)).slice(0, 8);
    if (!allowed.length) return [];
    const result = await this.pool.query(`
      SELECT proposal.*, project.name AS project_name, commitment.title AS commitment_title,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', event.id, 'eventType', event.event_type, 'occurredAt', event.occurred_at,
          'summary', event.summary, 'sourceChannel', event.source_channel,
          'confidence', event.confidence, 'trustLevel', event.trust_level
        ) ORDER BY evidence.position)
        FROM life_proposal_evidence evidence
        JOIN life_events event ON event.id = evidence.event_id AND event.user_id = evidence.user_id
        WHERE evidence.user_id = proposal.user_id AND evidence.proposal_id = proposal.id), '[]'::jsonb) AS evidence
      FROM life_proposals proposal
      LEFT JOIN life_projects project ON project.id = proposal.project_id AND project.user_id = proposal.user_id
      LEFT JOIN life_commitments commitment ON commitment.id = proposal.commitment_id AND commitment.user_id = proposal.user_id
      WHERE proposal.user_id = $1 AND proposal.status = ANY($2::text[])
        AND ($3::uuid IS NULL OR proposal.project_id = $3)
      ORDER BY proposal.expires_at, proposal.created_at DESC, proposal.id
      LIMIT $4
    `, [userId, allowed, projectId, Math.min(Math.max(Number(limit) || 30, 1), 100)]);
    return result.rows;
  }

  async listProjectDocuments({ userId, projectId, limit = 20 }) {
    const result = await this.pool.query(`
      SELECT DISTINCT document.id, document.original_name, document.media_type,
             document.category, document.status, document.updated_at
      FROM life_event_links project_link
      JOIN life_event_links document_link
        ON document_link.user_id = project_link.user_id AND document_link.event_id = project_link.event_id
       AND document_link.target_type = 'document'
      JOIN documents document
        ON document.id = document_link.target_id AND document.user_id = document_link.user_id
      WHERE project_link.user_id = $1 AND project_link.target_type = 'project' AND project_link.target_id = $2
      ORDER BY document.updated_at DESC, document.id
      LIMIT $3
    `, [userId, projectId, Math.min(Math.max(Number(limit) || 20, 1), 50)]);
    return result.rows;
  }

  async getProposal({ userId, proposalId, forUpdate = false, client = null }) {
    const executor = client || this.pool;
    const result = await executor.query(`
      SELECT * FROM life_proposals WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}
    `, [proposalId, userId]);
    return result.rows[0] || null;
  }

  async transitionProposal({ userId, proposalId, revision, fromStatuses, status, workflowId = null, confirmed = false }) {
    const allowedFrom = fromStatuses.filter((value) => [
      'open', 'confirmed', 'executing', 'completed', 'failed', 'outcome_unknown',
    ].includes(value));
    const result = await this.pool.query(`
      UPDATE life_proposals
      SET status = $5, workflow_id = COALESCE($6, workflow_id),
          confirmed_at = CASE WHEN $7 THEN now() ELSE confirmed_at END,
          revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3 AND status = ANY($4::text[])
      RETURNING *
    `, [proposalId, userId, revision, allowedFrom, status, workflowId, confirmed]);
    return result.rows[0] || null;
  }

  async expireProposals({ now = new Date(), limit = 100 } = {}) {
    const result = await this.pool.query(`
      WITH expired AS (
        SELECT id FROM life_proposals
        WHERE status = 'open' AND expires_at <= $1
        ORDER BY expires_at, id FOR UPDATE SKIP LOCKED LIMIT $2
      )
      UPDATE life_proposals proposal
      SET status = 'expired', revision = revision + 1, updated_at = now()
      FROM expired WHERE proposal.id = expired.id
      RETURNING proposal.*
    `, [now, Math.min(Math.max(Number(limit) || 100, 1), 100)]);
    return result.rows;
  }
}

module.exports = { DEFAULT_AREAS, LifeProjectionRepository, TARGET_TABLES };
