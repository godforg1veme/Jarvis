class WorkflowRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(input) {
    const result = await this.pool.query(`
      INSERT INTO action_workflows (
        id, user_id, conversation_id, origin_channel, origin_device_id,
        target_executor_type, target_id, status, state, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8::jsonb, $9)
      RETURNING *
    `, [input.id, input.userId, input.conversationId, input.originChannel,
      input.originDeviceId || null, input.targetExecutorType || 'device', input.targetId || null,
      JSON.stringify(input.state || {}), input.expiresAt]);
    return result.rows[0];
  }

  async getForUser({ userId, workflowId }) {
    const result = await this.pool.query(`
      SELECT * FROM action_workflows WHERE id = $1 AND user_id = $2
    `, [workflowId, userId]);
    return result.rows[0] || null;
  }

  async getActiveForConversation({ userId, conversationId, originChannel, originDeviceId = null }) {
    const result = await this.pool.query(`
      SELECT * FROM action_workflows
      WHERE user_id = $1 AND conversation_id = $2 AND origin_channel = $3
        AND status IN ('active', 'awaiting_input', 'awaiting_confirmation', 'awaiting_result')
        AND expires_at > now()
        AND ($4::uuid IS NULL OR origin_device_id = $4::uuid)
      ORDER BY updated_at DESC
      LIMIT 1
    `, [userId, conversationId, originChannel, originDeviceId]);
    return result.rows[0] || null;
  }

  async update({ userId, workflowId, expectedRevision, status, state, targetId = undefined, incrementStep = false, completed = false }) {
    const result = await this.pool.query(`
      UPDATE action_workflows
      SET status = $4,
          state = $5::jsonb,
          target_id = CASE WHEN $6::text IS NULL THEN target_id ELSE $6 END,
          step_count = step_count + CASE WHEN $7 THEN 1 ELSE 0 END,
          revision = revision + 1,
          updated_at = now(),
          completed_at = CASE WHEN $8 THEN now() ELSE completed_at END
      WHERE id = $1 AND user_id = $2 AND revision = $3
      RETURNING *
    `, [workflowId, userId, expectedRevision, status, JSON.stringify(state || {}),
      targetId === undefined ? null : targetId, incrementStep, completed]);
    return result.rows[0] || null;
  }

  async createRun(input) {
    const result = await this.pool.query(`
      INSERT INTO action_runs (
        id, workflow_id, user_id, position, executor_type, target_id,
        action, arguments, policy, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      RETURNING *
    `, [input.id, input.workflowId, input.userId, input.position, input.executorType,
      input.targetId || null, input.action, JSON.stringify(input.args || {}), input.policy, input.status || 'planned']);
    return result.rows[0];
  }

  async linkCommand({ userId, runId, commandId, status }) {
    const result = await this.pool.query(`
      UPDATE action_runs
      SET command_id = $3, status = $4, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND command_id IS NULL
      RETURNING *
    `, [runId, userId, commandId, status]);
    return result.rows[0] || null;
  }

  async completeRun({ userId, runId, status, result }) {
    const updated = await this.pool.query(`
      UPDATE action_runs
      SET status = $3, result = $4::jsonb, updated_at = now(), completed_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('planned', 'awaiting_confirmation', 'running')
      RETURNING *
    `, [runId, userId, status, JSON.stringify(result || {})]);
    return updated.rows[0] || null;
  }

  async runsForWorkflow({ userId, workflowId }) {
    const result = await this.pool.query(`
      SELECT id, position, executor_type, target_id, action, arguments, policy, status, result, command_id
      FROM action_runs WHERE workflow_id = $1 AND user_id = $2
      ORDER BY position ASC
    `, [workflowId, userId]);
    return result.rows;
  }
}

module.exports = { WorkflowRepository };
