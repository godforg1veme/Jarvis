const { AccessRepository } = require('../access/accessRepository');

function configuredOwnerJobAccess(pool, ownerTelegramId) {
  const ownerId = String(ownerTelegramId || '');
  const legacy = { async get(db, field, userId) {
    if (field !== 'user' || !/^[1-9]\d{0,19}$/.test(ownerId)) return null;
    const row = (await db.query(`SELECT external_id FROM user_identities
      WHERE user_id=$1 AND provider='telegram'`, [userId])).rows[0];
    if (row?.external_id !== ownerId) return null;
    return { userId, telegramId: ownerId, level: 'owner', blocked: false, roleId: null,
      roleRevision: 0, revision: 1, permissions: ['jobs'] };
  } };
  const persisted = new AccessRepository(pool, ownerId);
  const repository = { async get(db, field, userId) {
    return await persisted.get(db, field, userId) || legacy.get(db, field, userId);
  } };
  return { repository, getAccessForUser(userId) { return repository.get(pool, 'user', userId); } };
}

module.exports = { configuredOwnerJobAccess };
