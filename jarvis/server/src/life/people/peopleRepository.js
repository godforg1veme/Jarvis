const {
  createFamilyGrantSchema,
  createPersonProjectLinkSchema,
  createPersonSchema,
  createRelationshipSchema,
  revokeFamilyGrantSchema,
  updatePersonSchema,
} = require('./peopleSchemas');
const { isKnownEventCategoryId } = require('./familyAccessPolicy');

const GRANT_RESOURCE_TABLES = Object.freeze({
  area: 'life_areas',
  project: 'life_projects',
  commitment: 'life_commitments',
  calendar_source: 'life_source_connections',
});

function boundedLimit(value, fallback = 100, maximum = 200) {
  return Math.min(Math.max(Number(value) || fallback, 1), maximum);
}

class PeopleRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createPerson({ userId, ...raw }) {
    const input = createPersonSchema.parse(raw);
    const result = await this.pool.query(`
      INSERT INTO life_people (user_id, display_name, aliases, relationship_type, notes)
      VALUES ($1, $2, $3::jsonb, $4, $5)
      RETURNING *
    `, [userId, input.displayName, JSON.stringify(input.aliases), input.relationshipType, input.notes]);
    return result.rows[0] || null;
  }

  async getPerson({ userId, personId }) {
    const result = await this.pool.query(`
      SELECT * FROM life_people WHERE id = $1 AND user_id = $2
    `, [personId, userId]);
    return result.rows[0] || null;
  }

  async listPeople({ userId, includeArchived = false, limit = 100 }) {
    const result = await this.pool.query(`
      SELECT * FROM life_people
      WHERE user_id = $1 AND ($2 OR status = 'active')
      ORDER BY lower(display_name), id
      LIMIT $3
    `, [userId, Boolean(includeArchived), boundedLimit(limit)]);
    return result.rows;
  }

  async updatePerson({ userId, personId, ...raw }) {
    const input = updatePersonSchema.parse(raw);
    const fields = [];
    const params = [personId, userId, input.revision];
    const add = (column, value, cast = '') => {
      params.push(value);
      fields.push(`${column} = $${params.length}${cast}`);
    };
    if (input.displayName !== undefined) add('display_name', input.displayName);
    if (input.aliases !== undefined) add('aliases', JSON.stringify(input.aliases), '::jsonb');
    if (input.relationshipType !== undefined) add('relationship_type', input.relationshipType);
    if (input.notes !== undefined) add('notes', input.notes);
    if (input.status !== undefined) add('status', input.status);
    const result = await this.pool.query(`
      UPDATE life_people
      SET ${fields.join(', ')}, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3
      RETURNING *
    `, params);
    return result.rows[0] || null;
  }

  async createRelationship({ userId, ...raw }) {
    const input = createRelationshipSchema.parse(raw);
    const conflictTarget = input.relatedPersonId
      ? '(user_id, person_id, related_person_id, relation_type)'
      : '(user_id, person_id, relation_type) WHERE related_person_id IS NULL';
    const result = await this.pool.query(`
      INSERT INTO life_person_relationships (
        user_id, person_id, related_person_id, direction, relation_type, origin, confidence
      )
      SELECT $1, $2, $3, $4, $5, $6, $7
      WHERE EXISTS (SELECT 1 FROM life_people WHERE id = $2 AND user_id = $1 AND status = 'active')
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM life_people WHERE id = $3 AND user_id = $1 AND status = 'active'
        ))
      ON CONFLICT ${conflictTarget}
      DO UPDATE SET direction = EXCLUDED.direction, origin = EXCLUDED.origin,
        confidence = EXCLUDED.confidence, revision = life_person_relationships.revision + 1,
        updated_at = now()
      RETURNING *
    `, [userId, input.personId, input.relatedPersonId || null, input.direction,
      input.relationType, input.origin, input.confidence]);
    return result.rows[0] || null;
  }

  async createProjectLink({ userId, ...raw }) {
    const input = createPersonProjectLinkSchema.parse(raw);
    const result = await this.pool.query(`
      INSERT INTO life_person_project_links (user_id, person_id, project_id, role, origin, confidence)
      SELECT $1, $2, $3, $4, 'user', 1
      WHERE EXISTS (SELECT 1 FROM life_people WHERE id = $2 AND user_id = $1 AND status = 'active')
        AND EXISTS (SELECT 1 FROM life_projects WHERE id = $3 AND user_id = $1 AND status <> 'archived')
      ON CONFLICT (user_id, person_id, project_id, role)
      DO UPDATE SET origin = 'user', confidence = 1, updated_at = now()
      RETURNING *
    `, [userId, input.personId, input.projectId, input.role]);
    return result.rows[0] || null;
  }

  async createFamilyGrant({ userId, ...raw }) {
    const input = createFamilyGrantSchema.parse(raw);
    if (input.resourceType === 'event_category' && !isKnownEventCategoryId(input.resourceId)) {
      throw new Error('unknown family event category');
    }
    const resourceTable = GRANT_RESOURCE_TABLES[input.resourceType];
    const adapterCheck = input.resourceType === 'calendar_source' ? " AND adapter_type = 'calendar'" : '';
    const resourceCheck = resourceTable
      ? `EXISTS (SELECT 1 FROM ${resourceTable} WHERE id = $4 AND user_id = $1${adapterCheck})`
      : '$3 = \'event_category\'';
    const result = await this.pool.query(`
      INSERT INTO life_family_access_grants (
        user_id, member_user_id, resource_type, resource_id, permission, starts_at, expires_at
      )
      SELECT $1, $2, $3, $4, $5, COALESCE($6, now()), $7
      FROM users owner_user, users member_user
      WHERE owner_user.id = $1 AND owner_user.role = 'owner'
        AND member_user.id = $2 AND member_user.role = 'member'
        AND $1 <> $2 AND ${resourceCheck}
      ON CONFLICT (user_id, member_user_id, resource_type, resource_id, permission)
        WHERE revoked_at IS NULL
      DO UPDATE SET starts_at = EXCLUDED.starts_at, expires_at = EXCLUDED.expires_at,
        revision = life_family_access_grants.revision + 1, updated_at = now()
      RETURNING *
    `, [userId, input.memberUserId, input.resourceType, input.resourceId, input.permission,
      input.startsAt ? new Date(input.startsAt) : null, input.expiresAt ? new Date(input.expiresAt) : null]);
    return result.rows[0] || null;
  }

  async revokeFamilyGrant({ userId, grantId, ...raw }) {
    const input = revokeFamilyGrantSchema.parse(raw);
    const result = await this.pool.query(`
      UPDATE life_family_access_grants
      SET revoked_at = now(), revision = revision + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND revision = $3 AND revoked_at IS NULL
      RETURNING *
    `, [grantId, userId, input.revision]);
    return result.rows[0] || null;
  }

  async listFamilyGrants({ userId, memberUserId = null, includeInactive = false, limit = 100 }) {
    const result = await this.pool.query(`
      SELECT * FROM life_family_access_grants
      WHERE user_id = $1 AND ($2::uuid IS NULL OR member_user_id = $2)
        AND ($3 OR (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())))
      ORDER BY created_at DESC, id DESC
      LIMIT $4
    `, [userId, memberUserId, Boolean(includeInactive), boundedLimit(limit)]);
    return result.rows;
  }
}

module.exports = { GRANT_RESOURCE_TABLES, PeopleRepository };
