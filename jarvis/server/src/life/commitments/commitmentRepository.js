const { createCommitmentSchema } = require('../lifeSchemas');

class CommitmentRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ userId, ...raw }) {
    const input = createCommitmentSchema.parse({ userId, ...raw });
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
    `, [userId, input.sourceEventId, input.areaId || null, input.projectId || null,
      input.personId || null, input.kind, input.title, input.dueAt ? new Date(input.dueAt) : null,
      input.dueWindowEndAt ? new Date(input.dueWindowEndAt) : null,
      input.recurrence ? JSON.stringify(input.recurrence) : null,
      input.externalSourceRef || null, input.confidence]);
    return result.rows[0] || null;
  }

  async get({ userId, commitmentId }) {
    const result = await this.pool.query('SELECT * FROM life_commitments WHERE id = $1 AND user_id = $2', [commitmentId, userId]);
    return result.rows[0] || null;
  }

  async listRecent({ userId, projectId = null, personId = null, limit = 30 }) {
    const result = await this.pool.query(`
      SELECT * FROM life_commitments
      WHERE user_id = $1 AND status = 'open'
        AND ($2::uuid IS NULL OR project_id = $2)
        AND ($3::uuid IS NULL OR person_id = $3)
      ORDER BY updated_at DESC, id DESC LIMIT $4
    `, [userId, projectId, personId, Math.min(Math.max(Number(limit) || 30, 1), 50)]);
    return result.rows;
  }

  async transition({ userId, commitmentId, revision, status, dueAt, dueWindowEndAt, recurrence, title }) {
    if (!['open', 'completed', 'dismissed', 'expired'].includes(status)) throw new Error('invalid commitment status');
    const result = await this.pool.query(`
      UPDATE life_commitments SET
        status = $4, due_at = COALESCE($5, due_at),
        due_window_end_at = COALESCE($6, due_window_end_at),
        recurrence = CASE WHEN $7::jsonb IS NULL THEN recurrence ELSE $7::jsonb END,
        title = COALESCE($8, title), revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3 AND status = 'open'
      RETURNING *
    `, [commitmentId, userId, revision, status, dueAt ? new Date(dueAt) : null,
      dueWindowEndAt ? new Date(dueWindowEndAt) : null,
      recurrence ? JSON.stringify(recurrence) : null, title || null]);
    return result.rows[0] || null;
  }

  async isWorkflowLinked({ userId, commitmentId, workflowId }) {
    const result = await this.pool.query(`
      SELECT 1 FROM life_proposals proposal
      JOIN action_workflows workflow
        ON workflow.id = proposal.workflow_id AND workflow.user_id = proposal.user_id
      WHERE proposal.user_id = $1 AND proposal.commitment_id = $2
        AND proposal.workflow_id = $3 AND workflow.status = 'succeeded'
      LIMIT 1
    `, [userId, commitmentId, workflowId]);
    return result.rowCount > 0;
  }
}

module.exports = { CommitmentRepository };
