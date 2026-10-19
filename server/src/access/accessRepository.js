const { effectivePermissions } = require('./accessPolicy');
class AccessRepository {
  constructor(pool, ownerTelegramId) {
    this.pool = pool;
    this.ownerTelegramId = String(ownerTelegramId || '');
  }
  async get(db, field, value) {
    const row = (
      await db.query(
        `SELECT m.*,u.display_name,COALESCE(r.revision,0) AS role_revision,
      ARRAY(SELECT permission FROM access_role_permissions WHERE role_id=m.role_id ORDER BY permission) AS role_permissions,
      COALESCE((SELECT jsonb_object_agg(permission,effect) FROM access_user_overrides WHERE user_id=m.user_id),'{}') AS overrides
      FROM access_memberships m JOIN users u ON u.id=m.user_id
      LEFT JOIN access_roles r ON r.id=m.role_id
      JOIN user_identities i ON i.user_id=m.user_id AND i.provider='telegram' AND i.external_id=m.telegram_id
      WHERE ${field === 'telegram' ? 'm.telegram_id' : 'm.user_id'}=$1`,
        [value],
      )
    ).rows[0];
    if (!row) return null;
    const level =
      row.telegram_id === this.ownerTelegramId ? 'owner' : row.level;
    const blocked = level === 'owner' ? false : row.blocked;
    const result = {
      userId: row.user_id,
      telegramId: row.telegram_id,
      displayName: row.display_name,
      level,
      blocked,
      roleId: row.role_id,
      roleRevision: row.role_revision,
      overrides: row.overrides,
      revision: row.revision,
    };
    result.permissions = effectivePermissions({
      ...result,
      rolePermissions: row.role_permissions,
    });
    return result;
  }
  async ensureUser(db, telegramId, displayName, role = 'member') {
    const existing = (
      await db.query(
        "SELECT user_id FROM user_identities WHERE provider='telegram' AND external_id=$1",
        [telegramId],
      )
    ).rows[0];
    if (existing) return existing.user_id;
    const id = (
      await db.query(
        'INSERT INTO users(display_name,role) VALUES($1,$2) RETURNING id',
        [displayName, role],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram',$2)",
      [id, telegramId],
    );
    return id;
  }
  async roles(db) {
    return (
      await db.query(
        `SELECT id,name,revision,ARRAY(SELECT permission FROM access_role_permissions WHERE role_id=r.id ORDER BY permission) AS permissions FROM access_roles r ORDER BY name,id LIMIT 501`,
      )
    ).rows;
  }
  async writeRolePermissions(db, id, permissions) {
    await db.query('DELETE FROM access_role_permissions WHERE role_id=$1', [
      id,
    ]);
    for (const permission of permissions)
      await db.query(
        'INSERT INTO access_role_permissions(role_id,permission) VALUES($1,$2)',
        [id, permission],
      );
  }
}
module.exports = { AccessRepository };
