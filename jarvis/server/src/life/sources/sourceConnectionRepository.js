const { randomUUID } = require('node:crypto');
const { createSourceConnectionSchema, updateSourceConnectionSchema } = require('./sourceSchemas');

class SourceConnectionRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ userId, ...raw }) {
    const input = createSourceConnectionSchema.parse(raw);
    const result = await this.pool.query(`
      INSERT INTO life_source_connections (
        user_id, adapter_type, display_name, enabled, selected_scope,
        privacy_policy_version, configuration_metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
      RETURNING id, adapter_type, display_name, enabled, selected_scope,
        privacy_policy_version, configuration_metadata, health_status,
        last_successful_sync_at, last_failure_code, revision, created_at, updated_at
    `, [userId, input.adapterType, input.displayName, input.enabled,
      JSON.stringify(input.selectedScope), input.privacyPolicyVersion,
      JSON.stringify(input.configurationMetadata)]);
    return result.rows[0] || null;
  }

  async get({ userId, connectionId }) {
    const result = await this.pool.query(`
      SELECT id, adapter_type, display_name, enabled, selected_scope,
        privacy_policy_version, configuration_metadata, health_status,
        last_successful_sync_at, last_failure_code, revision, created_at, updated_at
      FROM life_source_connections WHERE id = $1 AND user_id = $2
    `, [connectionId, userId]);
    return result.rows[0] || null;
  }

  async list({ userId }) {
    const result = await this.pool.query(`
      SELECT id, adapter_type, display_name, enabled, selected_scope,
        privacy_policy_version, configuration_metadata, health_status,
        last_successful_sync_at, last_failure_code, revision, created_at, updated_at
      FROM life_source_connections WHERE user_id = $1
      ORDER BY adapter_type, lower(display_name), id
    `, [userId]);
    return result.rows;
  }

  async update({ userId, connectionId, ...raw }) {
    const input = updateSourceConnectionSchema.parse(raw);
    const fields = [];
    const params = [connectionId, userId, input.revision];
    const add = (column, value, cast = '') => {
      params.push(value);
      fields.push(`${column} = $${params.length}${cast}`);
    };
    if (input.displayName !== undefined) add('display_name', input.displayName);
    if (input.enabled !== undefined) add('enabled', input.enabled);
    if (input.selectedScope !== undefined) add('selected_scope', JSON.stringify(input.selectedScope), '::jsonb');
    if (input.privacyPolicyVersion !== undefined) add('privacy_policy_version', input.privacyPolicyVersion);
    if (input.configurationMetadata !== undefined) add('configuration_metadata', JSON.stringify(input.configurationMetadata), '::jsonb');
    const result = await this.pool.query(`
      UPDATE life_source_connections
      SET ${fields.join(', ')}, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3
      RETURNING id, adapter_type, display_name, enabled, selected_scope,
        privacy_policy_version, configuration_metadata, health_status,
        last_successful_sync_at, last_failure_code, revision, created_at, updated_at
    `, params);
    return result.rows[0] || null;
  }

  async ensureCursor({ userId, connectionId, adapterSchemaVersion, cursorValue = 'initial' }) {
    const boundedCursor = validateCursor(cursorValue);
    const result = await this.pool.query(`
      INSERT INTO life_source_cursors (
        user_id, connection_id, adapter_schema_version, cursor_value
      )
      SELECT $1, $2, $3, $4
      WHERE EXISTS (SELECT 1 FROM life_source_connections WHERE id = $2 AND user_id = $1)
      ON CONFLICT (user_id, connection_id) DO UPDATE
        SET connection_id = EXCLUDED.connection_id
      RETURNING *
    `, [userId, connectionId, adapterSchemaVersion, boundedCursor]);
    return result.rows[0] || null;
  }

  async claimCursor({ userId, connectionId, staleBefore }) {
    const claimToken = randomUUID();
    const result = await this.pool.query(`
      UPDATE life_source_cursors
      SET claim_token = $1, claimed_at = now(), revision = revision + 1, updated_at = now()
      WHERE user_id = $2 AND connection_id = $3
        AND (claim_token IS NULL OR claimed_at < $4)
      RETURNING *
    `, [claimToken, userId, connectionId, new Date(staleBefore)]);
    return result.rows[0] ? { claimToken, cursor: result.rows[0] } : null;
  }

  async commitCursor({ userId, connectionId, claimToken, cursorValue, adapterSchemaVersion }) {
    const boundedCursor = validateCursor(cursorValue);
    const result = await this.pool.query(`
      UPDATE life_source_cursors
      SET cursor_value = $4, adapter_schema_version = $5,
        claim_token = NULL, claimed_at = NULL,
        revision = revision + 1, updated_at = now()
      WHERE user_id = $1 AND connection_id = $2 AND claim_token = $3
      RETURNING *
    `, [userId, connectionId, claimToken, boundedCursor, adapterSchemaVersion]);
    return result.rows[0] || null;
  }
}

function validateCursor(value) {
  const cursor = String(value || '');
  if (!cursor || cursor.length > 2048) throw new Error('source cursor is invalid');
  return cursor;
}

module.exports = { SourceConnectionRepository };
