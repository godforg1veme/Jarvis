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

  async listRelationships({ userId, personId = null, limit = 100 }) {
    const result = await this.pool.query(`
      SELECT * FROM life_person_relationships
      WHERE user_id = $1 AND ($2::uuid IS NULL OR person_id = $2 OR related_person_id = $2)
      ORDER BY updated_at DESC, id DESC LIMIT $3
    `, [userId, personId, boundedLimit(limit)]);
    return result.rows;
  }

  async listProjectLinks({ userId, projectId = null, personId = null, limit = 100 }) {
    const result = await this.pool.query(`
      SELECT link.*, person.display_name, project.name AS project_name
      FROM life_person_project_links link
      JOIN life_people person ON person.user_id = link.user_id AND person.id = link.person_id
      JOIN life_projects project ON project.user_id = link.user_id AND project.id = link.project_id
      WHERE link.user_id = $1
        AND ($2::uuid IS NULL OR link.project_id = $2)
        AND ($3::uuid IS NULL OR link.person_id = $3)
      ORDER BY link.updated_at DESC, link.id DESC LIMIT $4
    `, [userId, projectId, personId, boundedLimit(limit)]);
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

  async findActiveGrant({ userId, memberUserId, resourceType, resourceId, permission, now = new Date() }) {
    const result = await this.pool.query(`
      SELECT * FROM life_family_access_grants
      WHERE user_id = $1 AND member_user_id = $2 AND resource_type = $3
        AND resource_id = $4 AND permission = $5 AND revoked_at IS NULL
        AND starts_at <= $6 AND (expires_at IS NULL OR expires_at > $6)
      LIMIT 1
    `, [userId, memberUserId, resourceType, resourceId, permission, now]);
    return result.rows[0] || null;
  }

  async listSharedSummaries({ memberUserId, now = new Date(), limit = 100 }) {
    const result = await this.pool.query(`
      SELECT grant.id AS grant_id, grant.resource_type, grant.resource_id, grant.permission, grant.expires_at,
        COALESCE(project.name, area.name, commitment.title, source.display_name) AS label,
        CASE
          WHEN grant.resource_type = 'project' THEN project.summary
          WHEN grant.resource_type = 'commitment' THEN concat_ws(' · ', commitment.status, commitment.due_at::text)
          ELSE ''
        END AS summary
      FROM life_family_access_grants grant
      LEFT JOIN life_projects project ON grant.resource_type = 'project'
        AND project.user_id = grant.user_id AND project.id = grant.resource_id
      LEFT JOIN life_areas area ON grant.resource_type = 'area'
        AND area.user_id = grant.user_id AND area.id = grant.resource_id
      LEFT JOIN life_commitments commitment ON grant.resource_type = 'commitment'
        AND commitment.user_id = grant.user_id AND commitment.id = grant.resource_id
      LEFT JOIN life_source_connections source ON grant.resource_type = 'calendar_source'
        AND source.user_id = grant.user_id AND source.id = grant.resource_id AND source.adapter_type = 'calendar'
      WHERE grant.member_user_id = $1 AND grant.permission = 'view_summary'
        AND grant.revoked_at IS NULL AND grant.starts_at <= $2
        AND (grant.expires_at IS NULL OR grant.expires_at > $2)
      ORDER BY grant.updated_at DESC, grant.id DESC LIMIT $3
    `, [memberUserId, now, boundedLimit(limit)]);
    return result.rows;
  }
}

module.exports = { GRANT_RESOURCE_TABLES, PeopleRepository };
