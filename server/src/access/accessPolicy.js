const { PERMISSIONS } = require('./permissionCatalog');
function effectivePermissions({
  blocked,
  level,
  rolePermissions = [],
  overrides = {},
}) {
  if (level === 'owner') return [...PERMISSIONS];
  if (blocked) return [];
  return PERMISSIONS.filter((p) =>
    overrides[p] === 'deny'
      ? false
      : overrides[p] === 'allow' ||
        level === 'owner' ||
        level === 'admin' ||
        rolePermissions.includes(p),
  );
}
function accessError(code) {
  return Object.assign(new Error(code), { code });
}
function requireAdmin(actor) {
  if (!actor || actor.blocked || !['owner', 'admin'].includes(actor.level))
    throw accessError('forbidden');
}
function protectTarget(actor, target, patch) {
  requireAdmin(actor);
  if (target?.level === 'owner') throw accessError('protected_owner');
  if (
    actor.level !== 'owner' &&
    (target?.level === 'admin' || (patch.level && patch.level !== 'member'))
  )
    throw accessError('forbidden');
  if (patch.level === 'owner') throw accessError('protected_owner');
}
module.exports = {
  effectivePermissions,
  accessError,
  requireAdmin,
  protectTarget,
};
