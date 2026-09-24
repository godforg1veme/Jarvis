const { parsePreferenceInput } = require('./lifePreferenceSchemas');

class LifePreferenceRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list({ userId }) {
    const result = await this.pool.query(`
      SELECT id, preference_key, value, source, explanation, evidence_count,
        confidence, revision, created_at, updated_at
      FROM life_preferences WHERE user_id = $1
      ORDER BY preference_key
    `, [userId]);
    return result.rows;
  }

  async get({ userId, key }) {
    const result = await this.pool.query(`
      SELECT * FROM life_preferences WHERE user_id = $1 AND preference_key = $2
    `, [userId, key]);
    return result.rows[0] || null;
  }

  async setExplicit({ userId, ...raw }) {
    const input = parsePreferenceInput(raw);
    if (input.key === 'areas.priorities' && input.value.length) {
      const areaIds = input.value.map((item) => item.areaId);
      const owned = await this.pool.query(`
        SELECT count(*)::integer AS count FROM life_areas
        WHERE user_id = $1 AND id = ANY($2::uuid[])
      `, [userId, areaIds]);
      if (Number(owned.rows[0]?.count || 0) !== areaIds.length) return null;
    }
    const result = await this.pool.query(`
      INSERT INTO life_preferences (
        user_id, preference_key, value, source, explanation, evidence_count, confidence
      )
      VALUES ($1, $2, $3::jsonb, 'explicit', '', 0, 1)
      ON CONFLICT (user_id, preference_key) DO UPDATE SET
        value = EXCLUDED.value, source = 'explicit', explanation = '',
        evidence_count = 0, confidence = 1,
        revision = life_preferences.revision + 1, updated_at = now()
      WHERE life_preferences.revision = $4
      RETURNING *
    `, [userId, input.key, JSON.stringify(input.value), input.revision]);
    return result.rows[0] || null;
  }

  async setDerived({ userId, key, value, explanation, evidenceCount, confidence, expectedRevision = null }) {
    const input = parsePreferenceInput({ key, value, revision: expectedRevision });
    const result = await this.pool.query(`
      INSERT INTO life_preferences (
        user_id, preference_key, value, source, explanation, evidence_count, confidence
      )
      VALUES ($1, $2, $3::jsonb, 'derived', $4, $5, $6)
      ON CONFLICT (user_id, preference_key) DO UPDATE SET
        value = EXCLUDED.value, source = 'derived', explanation = EXCLUDED.explanation,
        evidence_count = EXCLUDED.evidence_count, confidence = EXCLUDED.confidence,
        revision = life_preferences.revision + 1, updated_at = now()
      WHERE life_preferences.source = 'derived'
        AND ($7::integer IS NULL OR life_preferences.revision = $7)
      RETURNING *
    `, [userId, input.key, JSON.stringify(input.value), String(explanation || '').slice(0, 500),
      Math.min(Math.max(Number(evidenceCount) || 0, 0), 100000),
      Math.min(Math.max(Number(confidence) || 0, 0), 1), expectedRevision]);
    return result.rows[0] || null;
  }

  async remove({ userId, key, revision }) {
    const input = parsePreferenceInput({ key, value: defaultValue(key), revision });
    const result = await this.pool.query(`
      DELETE FROM life_preferences
      WHERE user_id = $1 AND preference_key = $2 AND revision = $3
      RETURNING id, preference_key, source, revision
    `, [userId, input.key, input.revision]);
    return result.rows[0] || null;
  }

  async listProposalFeedback({ userId, limit = 1000 }) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
    const result = await this.pool.query(`
      SELECT feedback.id, feedback.target_id, feedback.kind, proposal.source_rule
      FROM life_feedback feedback
      JOIN life_proposals proposal
        ON proposal.user_id = feedback.user_id AND proposal.id = feedback.target_id
      WHERE feedback.user_id = $1 AND feedback.target_type = 'proposal'
        AND feedback.created_at > COALESCE((
          SELECT max(event.occurred_at) FROM life_events event
          WHERE event.user_id = $1 AND event.event_type = 'preference.deleted'
            AND event.structured_data ->> 'key' = 'proposal.suppressed_rules'
        ), '-infinity'::timestamptz)
      ORDER BY feedback.created_at DESC, feedback.id DESC
      LIMIT $2
    `, [userId, boundedLimit]);
    return result.rows;
  }
}

const DEFAULT_PREFERENCES = Object.freeze({
  'response.style': 'balanced',
  'contextual_adaptation.enabled': true,
  'initiative.level': 'normal',
  'notifications.quiet_hours': Object.freeze({ startMinutes: 1320, endMinutes: 480, timezone: 'UTC' }),
  'notifications.max_proactive_per_day': 5,
  'areas.priorities': Object.freeze([]),
  'proposal.suppressed_rules': Object.freeze([]),
  'links.low_confidence_behavior': 'ask',
  'reminders.default_lead_minutes': 60,
});

function defaultValue(key) {
  return DEFAULT_PREFERENCES[key];
}

module.exports = { DEFAULT_PREFERENCES, LifePreferenceRepository };
