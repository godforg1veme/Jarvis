class ProactivityRepository {
  constructor(pool) { this.pool = pool; }

  async countOpenForRule({ userId, sourceRule, projectId = null, commitmentId = null, personId = null }) {
    const result = await this.pool.query(`
      SELECT count(*)::integer AS count
      FROM life_proposals
      WHERE user_id = $1 AND source_rule = $2 AND status = 'open'
        AND expires_at > now()
        AND ($3::uuid IS NULL OR project_id = $3)
        AND ($4::uuid IS NULL OR commitment_id = $4)
        AND ($5::uuid IS NULL OR person_id = $5)
    `, [userId, sourceRule, projectId, commitmentId, personId]);
    return Number(result.rows[0]?.count || 0);
  }

  async countCreatedSince({ userId, since }) {
    const result = await this.pool.query(`
      SELECT count(*)::integer AS count FROM life_proposals
      WHERE user_id = $1 AND created_at >= $2
    `, [userId, since]);
    return Number(result.rows[0]?.count || 0);
  }
}

module.exports = { ProactivityRepository };
