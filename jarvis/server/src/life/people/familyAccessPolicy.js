const EVENT_CATEGORY_IDS = Object.freeze({
  family: '10000000-0000-4000-8000-000000000001',
  home: '10000000-0000-4000-8000-000000000002',
  schedule: '10000000-0000-4000-8000-000000000003',
});

function isKnownEventCategoryId(resourceId) {
  return Object.values(EVENT_CATEGORY_IDS).includes(String(resourceId || '').toLowerCase());
}

function isGrantActive(grant, now = new Date()) {
  if (!grant || grant.revoked_at) return false;
  const current = now instanceof Date ? now : new Date(now);
  if (grant.starts_at && new Date(grant.starts_at) > current) return false;
  if (grant.expires_at && new Date(grant.expires_at) <= current) return false;
  return true;
}

function allowsFamilyAccess(grant, { ownerUserId, memberUserId, resourceType, resourceId, permission, now = new Date() }) {
  return isGrantActive(grant, now)
    && grant.user_id === ownerUserId
    && grant.member_user_id === memberUserId
    && grant.resource_type === resourceType
    && grant.resource_id === resourceId
    && grant.permission === permission;
}

module.exports = { EVENT_CATEGORY_IDS, allowsFamilyAccess, isGrantActive, isKnownEventCategoryId };
