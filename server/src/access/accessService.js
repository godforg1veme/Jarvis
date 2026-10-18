const { createHash } = require('node:crypto');
const { z } = require('zod');
const { AccessRepository } = require('./accessRepository');
const { PERMISSIONS, LEGACY_PERMISSIONS } = require('./permissionCatalog');
const { accessError, requireAdmin, protectTarget } = require('./accessPolicy');
const telegramId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const permissions = z
  .array(z.enum(PERMISSIONS))
  .max(8)
  .refine((v) => new Set(v).size === v.length);
const overrides = z.partialRecord(
  z.enum(PERMISSIONS),
  z.enum(['allow', 'deny']),
);
const base = { operationId: z.uuid() };
const schemas = {
  'user.create': z.strictObject({
    ...base,
    telegramId,
    displayName: z.string().trim().min(1).max(100),
    roleId: z.uuid().nullable(),
    level: z.enum(['member', 'admin']),
  }),
  'user.update': z.strictObject({
    ...base,
    revision: z.number().int().positive(),
    roleId: z.uuid().nullable().optional(),
    overrides: overrides.optional(),
    blocked: z.boolean().optional(),
    level: z.enum(['member', 'admin']).optional(),
  }),
  'role.create': z.strictObject({
    ...base,
    name: z.string().trim().min(1).max(80),
    permissions,
  }),
  'role.update': z.strictObject({
    ...base,
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    permissions,
  }),
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
class AccessService {
  constructor({ pool, ownerTelegramId, legacyAllowedIds = [] }) {
    this.pool = pool;
    this.ownerTelegramId = String(ownerTelegramId || '');
    this.legacyAllowedIds = legacyAllowedIds;
    this.repository = new AccessRepository(pool, this.ownerTelegramId);
  }
  async transaction(fn) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('jarvis-access-admin'))",
      );
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }
  async initialize() {
    if (!telegramId.safeParse(this.ownerTelegramId).success)
      throw accessError('owner_configuration_required');
    await this.transaction(async (db) => {
      const role = (
        await db.query(
          "INSERT INTO access_roles(name,bootstrap_key) VALUES('Базовый доступ','legacy') ON CONFLICT(bootstrap_key) DO UPDATE SET bootstrap_key=EXCLUDED.bootstrap_key RETURNING id",
        )
      ).rows[0];
      // Only a newly created legacy role receives defaults; later assignments are authoritative.
      const count = (
        await db.query('SELECT count(*)::int AS n FROM access_memberships')
      ).rows[0].n;
      if (count === 0)
        await this.repository.writeRolePermissions(
          db,
          role.id,
          LEGACY_PERMISSIONS,
        );
      for (const raw of new Set([
        this.ownerTelegramId,
        ...this.legacyAllowedIds,
      ])) {
        const id = String(raw);
        if (!telegramId.safeParse(id).success) continue;
        const userId = await this.repository.ensureUser(
          db,
          id,
          `Telegram ${id}`,
          id === this.ownerTelegramId ? 'owner' : 'member',
        );
        await db.query(
          'INSERT INTO access_memberships(user_id,telegram_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [userId, id, role.id],
        );
      }
    });
  }
  getAccessForTelegram(id) {
    if (!telegramId.safeParse(String(id)).success) return Promise.resolve(null);
    return this.repository.get(this.pool, 'telegram', String(id));
  }
  getAccessForUser(id) {
    if (!z.uuid().safeParse(id).success) return Promise.resolve(null);
    return this.repository.get(this.pool, 'user', id);
  }
  async isAllowedTelegram(id) {
    const a = await this.getAccessForTelegram(id);
    return Boolean(a && !a.blocked);
  }
  async allows(id, permission) {
    const a = await this.getAccessForUser(id);
    return Boolean(a && !a.blocked && a.permissions.includes(permission));
  }
  async listAdmin(actorId) {
    return this.transaction(async (db) => {
      requireAdmin(await this.repository.get(db, 'user', actorId));
      const ids = (
        await db.query(
          'SELECT telegram_id FROM access_memberships ORDER BY telegram_id LIMIT 501',
        )
      ).rows;
      if (ids.length > 500) throw accessError('limit_reached');
      const users = [];
      for (const row of ids) {
        const user = await this.repository.get(db, 'telegram', row.telegram_id);
        if (user) users.push(user);
      }
      const roles = await this.repository.roles(db);
      if (roles.length > 500) throw accessError('limit_reached');
      const audit = (
        await db.query(
          'SELECT actor_id AS "actorId",operation_id AS "operationId",kind,target,changes,created_at AS "createdAt" FROM access_audit ORDER BY id DESC LIMIT 100',
        )
      ).rows;
      return { users, roles, audit };
    });
  }
  async getOperation(actorId, id) {
    if (!z.uuid().safeParse(id).success) throw accessError('invalid_request');
    return this.transaction(async (db) => {
      requireAdmin(await this.repository.get(db, 'user', actorId));
      const row = (
        await db.query(
          'SELECT result FROM access_operations WHERE actor_id=$1 AND operation_id=$2',
          [actorId, id],
        )
      ).rows[0];
      if (!row) throw accessError('operation_unknown');
      return row.result;
    });
  }
  async mutate(actorId, kind, input, target = null) {
    const parsed = schemas[kind]?.safeParse(input);
    if (!parsed?.success) throw accessError('invalid_request');
    const payload = parsed.data;
    if (
      (kind === 'user.update' && !telegramId.safeParse(target).success) ||
      (kind === 'role.update' && !z.uuid().safeParse(target).success)
    )
      throw accessError('invalid_request');
    const digest = createHash('sha256')
      .update(JSON.stringify(canonical({ kind, target, payload })))
      .digest('hex');
    return this.transaction(async (db) => {
      const actor = await this.repository.get(db, 'user', actorId);
      requireAdmin(actor);
      const previous = (
        await db.query(
          'SELECT digest,result FROM access_operations WHERE actor_id=$1 AND operation_id=$2',
          [actorId, payload.operationId],
        )
      ).rows[0];
      if (previous) {
        if (previous.digest !== digest) throw accessError('operation_conflict');
        return previous.result;
      }
      let result,
        before = null;
      if (kind.startsWith('user.')) {
        const id = kind === 'user.create' ? payload.telegramId : target;
        before = await this.repository.get(db, 'telegram', id);
        protectTarget(actor, before, payload);
        if (id === this.ownerTelegramId) throw accessError('protected_owner');
        if (kind === 'user.create' && before)
          throw accessError('already_exists');
        if (kind === 'user.update' && !before) throw accessError('not_found');
        if (before && before.revision !== payload.revision)
          throw accessError('revision_conflict');
        if (
          payload.roleId &&
          !(
            await db.query('SELECT id FROM access_roles WHERE id=$1', [
              payload.roleId,
            ])
          ).rows[0]
        )
          throw accessError('invalid_role');
        if (kind === 'user.create') {
          if (
            (
              await db.query(
                'SELECT count(*)::int AS n FROM access_memberships',
              )
            ).rows[0].n >= 500
          )
            throw accessError('limit_reached');
          const userId = await this.repository.ensureUser(
            db,
            id,
            payload.displayName,
          );
          await db.query(
            'INSERT INTO access_memberships(user_id,telegram_id,role_id,level) VALUES($1,$2,$3,$4)',
            [userId, id, payload.roleId, payload.level],
          );
        } else {
          await db.query(
            'UPDATE access_memberships SET role_id=$2,level=$3,blocked=$4,revision=revision+1 WHERE user_id=$1',
            [
              before.userId,
              payload.roleId === undefined ? before.roleId : payload.roleId,
              payload.level || before.level,
              payload.blocked === undefined ? before.blocked : payload.blocked,
            ],
          );
          if (payload.overrides !== undefined) {
            await db.query(
              'DELETE FROM access_user_overrides WHERE user_id=$1',
              [before.userId],
            );
            for (const [p, e] of Object.entries(payload.overrides))
              await db.query(
                'INSERT INTO access_user_overrides(user_id,permission,effect) VALUES($1,$2,$3)',
                [before.userId, p, e],
              );
          }
          // Revoke existing browser sessions on block, even when later unblocked.
          if (payload.blocked)
            await db.query('DELETE FROM mini_app_sessions WHERE user_id=$1', [
              before.userId,
            ]);
        }
        result = await this.repository.get(db, 'telegram', id);
        target = id;
      } else {
        if (kind === 'role.update') {
          before = (await this.repository.roles(db)).find(
            (r) => r.id === target,
          );
          if (!before) throw accessError('not_found');
          if (before.revision !== payload.revision)
            throw accessError('revision_conflict');
          await db.query(
            'UPDATE access_roles SET name=$2,revision=revision+1 WHERE id=$1',
            [target, payload.name],
          );
          // A pending user editor must not confirm a role snapshot which has
          // changed since it was displayed.
          await db.query('UPDATE access_memberships SET revision=revision+1 WHERE role_id=$1', [target]);
        } else {
          if (
            (await db.query('SELECT count(*)::int AS n FROM access_roles'))
              .rows[0].n >= 500
          )
            throw accessError('limit_reached');
          target = (
            await db.query(
              'INSERT INTO access_roles(name) VALUES($1) RETURNING id',
              [payload.name],
            )
          ).rows[0].id;
        }
        await this.repository.writeRolePermissions(
          db,
          target,
          payload.permissions,
        );
        result = (await this.repository.roles(db)).find((r) => r.id === target);
      }
      await db.query(
        'INSERT INTO access_operations(actor_id,operation_id,digest,result) VALUES($1,$2,$3,$4)',
        [actorId, payload.operationId, digest, JSON.stringify(result)],
      );
      await db.query(
        'INSERT INTO access_audit(actor_id,operation_id,kind,target,changes) VALUES($1,$2,$3,$4,$5)',
        [
          actorId,
          payload.operationId,
          kind,
          target,
          JSON.stringify({ before, after: result }),
        ],
      );
      return result;
    });
  }
}
module.exports = { AccessService, schemas, canonical };
