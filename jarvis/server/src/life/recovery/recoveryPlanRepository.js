const { createRecoveryPlanSchema } = require('./recoverySchemas');

class RecoveryPlanRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ userId, ...raw }) {
    const input = createRecoveryPlanSchema.parse(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const planResult = await client.query(`
        INSERT INTO life_recovery_plans (
          user_id, project_id, source_context_revision, summary, creation_reason,
          status, origin_channel, origin_conversation_id, origin_device_id,
          idempotency_key, expires_at
        )
        SELECT $1, $2, $3, $4, $5, 'ready', $6, $7, $8, $9, $10
        WHERE EXISTS (SELECT 1 FROM life_projects WHERE id = $2 AND user_id = $1 AND status <> 'archived')
          AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM conversations WHERE id = $7 AND user_id = $1))
          AND ($8::uuid IS NULL OR EXISTS (SELECT 1 FROM devices WHERE id = $8 AND user_id = $1))
        ON CONFLICT (user_id, idempotency_key)
        DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
        RETURNING *
      `, [userId, input.projectId, input.sourceContextRevision, input.summary,
        input.creationReason, input.originChannel, input.originConversationId || null,
        input.originDeviceId || null, input.idempotencyKey, new Date(input.expiresAt)]);
      const plan = planResult.rows[0] || null;
      if (!plan) {
        const error = new Error('recovery plan scope is unavailable');
        error.publicCode = 'LIFE_RECOVERY_SCOPE_UNAVAILABLE';
        throw error;
      }
      const steps = [];
      for (const step of input.steps) {
        const stepResult = await client.query(`
          INSERT INTO life_recovery_steps (
            user_id, plan_id, position, step_type, label, risk_class,
            action_name, resource_ref, depends_on_positions
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::smallint[])
          ON CONFLICT (plan_id, position)
          DO UPDATE SET position = EXCLUDED.position
          RETURNING *
        `, [userId, plan.id, step.position, step.stepType, step.label, step.riskClass,
          step.actionName || null, step.resourceRef || null, step.dependsOnPositions]);
        steps.push(stepResult.rows[0]);
      }
      await client.query('COMMIT');
      return { ...plan, steps };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get({ userId, planId }) {
    const planResult = await this.pool.query(`
      SELECT * FROM life_recovery_plans WHERE id = $1 AND user_id = $2
    `, [planId, userId]);
    if (!planResult.rows[0]) return null;
    const stepsResult = await this.pool.query(`
      SELECT * FROM life_recovery_steps WHERE plan_id = $1 AND user_id = $2 ORDER BY position
    `, [planId, userId]);
    return { ...planResult.rows[0], steps: stepsResult.rows };
  }

  async list({ userId, statuses = ['ready', 'awaiting_confirmation', 'executing', 'partial', 'outcome_unknown'], limit = 20 }) {
    const allowed = statuses.filter((status) => [
      'draft', 'ready', 'awaiting_confirmation', 'executing', 'completed', 'partial',
      'failed', 'outcome_unknown', 'expired', 'cancelled',
    ].includes(status)).slice(0, 10);
    if (!allowed.length) return [];
    const result = await this.pool.query(`
      SELECT * FROM life_recovery_plans
      WHERE user_id = $1 AND status = ANY($2::text[])
      ORDER BY updated_at DESC, id DESC LIMIT $3
    `, [userId, allowed, Math.min(Math.max(Number(limit) || 20, 1), 50)]);
    return result.rows;
  }

  async transition({ userId, planId, revision, fromStatuses, status }) {
    const allowedStatuses = [
      'draft', 'ready', 'awaiting_confirmation', 'executing', 'completed', 'partial',
      'failed', 'outcome_unknown', 'expired', 'cancelled',
    ];
    const from = fromStatuses.filter((value) => allowedStatuses.includes(value));
    if (!from.length || !allowedStatuses.includes(status)) throw new Error('invalid recovery transition');
    const result = await this.pool.query(`
      UPDATE life_recovery_plans
      SET status = $5, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3 AND status = ANY($4::text[])
      RETURNING *
    `, [planId, userId, revision, from, status]);
    return result.rows[0] || null;
  }
}

module.exports = { RecoveryPlanRepository };
