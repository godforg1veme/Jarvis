const { EVENT_CATEGORY_IDS } = require('./familyAccessPolicy');
const { FAMILY_PERMISSIONS, FAMILY_RESOURCE_TYPES } = require('./peopleSchemas');

const CATEGORY_LABELS = Object.freeze(Object.fromEntries(Object.entries(EVENT_CATEGORY_IDS).map(([label, id]) => [id, label])));

class FamilyAccessService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway || null;
    this.now = options.now || (() => new Date());
  }

  async create({ userId, input, sourceDeviceId = null }) {
    const row = await this.repository.createFamilyGrant({ userId, ...input });
    if (row) await this._record({ userId, row, eventType: 'family_access.granted', sourceDeviceId });
    return row;
  }

  async revoke({ userId, grantId, revision, sourceDeviceId = null }) {
    const row = await this.repository.revokeFamilyGrant({ userId, grantId, revision });
    if (row) await this._record({ userId, row, eventType: 'family_access.revoked', sourceDeviceId });
    return row;
  }

  listOwned({ userId, memberUserId = null, includeInactive = false }) {
    return this.repository.listFamilyGrants({ userId, memberUserId, includeInactive, limit: 100 });
  }

  async authorize(input) {
    if (!FAMILY_RESOURCE_TYPES.includes(input.resourceType) || !FAMILY_PERMISSIONS.includes(input.permission)) return false;
    return Boolean(await this.repository.findActiveGrant({ ...input, now: this.now() }));
  }

  async listShared({ memberUserId }) {
    const rows = await this.repository.listSharedSummaries({ memberUserId, now: this.now(), limit: 100 });
    return rows.map((row) => ({
      grantId: row.grant_id, resourceType: row.resource_type, permission: row.permission,
      label: row.resource_type === 'event_category' ? CATEGORY_LABELS[row.resource_id] || 'family' : String(row.label || '').slice(0, 160),
      summary: String(row.summary || '').slice(0, 500),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    }));
  }

  async _record({ userId, row, eventType, sourceDeviceId }) {
    if (!this.gateway) return;
    await this.gateway.record({
      userId, eventType, occurredAt: this.now(), sourceChannel: 'life_os',
      sourceRef: `${eventType}:${row.id}:revision:${row.revision}`, sourceDeviceId,
      deduplicationKey: `${eventType}:${row.id}:revision:${row.revision}`,
      summary: eventType === 'family_access.revoked' ? 'Семейный доступ отозван' : 'Семейный доступ предоставлен',
      structuredData: {
        grantId: row.id, memberUserId: row.member_user_id,
        resourceType: row.resource_type, resourceId: row.resource_id, permission: row.permission,
      },
      trustLevel: 'user', privacyClass: 'family',
    });
  }
}

module.exports = { FamilyAccessService };
