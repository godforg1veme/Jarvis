const { priorityCalculationSchema, priorityIntentSchema } = require('./prioritySchemas');

class PriorityRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list({ userId }) {
    const result = await this.pool.query(`
      SELECT * FROM life_project_priority_state
      WHERE user_id = $1
      ORDER BY pinned DESC, calculated_score DESC, project_id
    `, [userId]);
    return result.rows;
  }

  async setIntent({ userId, ...raw }) {
    const input = priorityIntentSchema.parse(raw);
    const result = await this.pool.query(`
      WITH eligible AS (
        SELECT project.id
        FROM life_projects project
        LEFT JOIN life_project_priority_state existing
          ON existing.user_id = project.user_id AND existing.project_id = project.id
        WHERE project.id = $2 AND project.user_id = $1 AND project.status = 'active'
          AND (($3::integer IS NULL AND existing.id IS NULL) OR existing.revision = $3)
      ), cleared AS (
        UPDATE life_project_priority_state
        SET pinned = false, revision = revision + 1, updated_at = now()
        WHERE user_id = $1 AND project_id <> $2 AND pinned AND $4
          AND EXISTS (SELECT 1 FROM eligible)
        RETURNING id
      )
      INSERT INTO life_project_priority_state (
        user_id, project_id, pinned, hidden_until, user_weight
      )
      SELECT $1, eligible.id, $4, $5, $6 FROM eligible
      ON CONFLICT (user_id, project_id) DO UPDATE SET
        pinned = EXCLUDED.pinned, hidden_until = EXCLUDED.hidden_until,
        user_weight = EXCLUDED.user_weight,
        revision = life_project_priority_state.revision + 1, updated_at = now()
      RETURNING *
    `, [userId, input.projectId, input.revision, input.pinned,
      input.hiddenUntil ? new Date(input.hiddenUntil) : null, input.userWeight]);
    return result.rows[0] || null;
  }

  async saveCalculation({ userId, ...raw }) {
    const input = priorityCalculationSchema.parse(raw);
    const result = await this.pool.query(`
      INSERT INTO life_project_priority_state (
        user_id, project_id, calculated_score, confidence, factor_breakdown,
        calculation_version, calculated_at
      )
      SELECT $1, $2, $3, $4, $5::jsonb, $6, now()
      WHERE EXISTS (SELECT 1 FROM life_projects WHERE id = $2 AND user_id = $1 AND status = 'active')
      ON CONFLICT (user_id, project_id) DO UPDATE SET
        calculated_score = EXCLUDED.calculated_score,
        confidence = EXCLUDED.confidence,
        factor_breakdown = EXCLUDED.factor_breakdown,
        calculation_version = EXCLUDED.calculation_version,
        calculated_at = now(), updated_at = now()
      RETURNING *
    `, [userId, input.projectId, input.score, input.confidence,
      JSON.stringify(input.factors), input.calculationVersion]);
    return result.rows[0] || null;
  }
}

module.exports = { PriorityRepository, priorityCalculationSchema, priorityIntentSchema };
