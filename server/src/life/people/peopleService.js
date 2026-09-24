class PeopleService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway || null;
    this.now = options.now || (() => new Date());
  }

  list({ userId, includeArchived = false }) {
    return this.repository.listPeople({ userId, includeArchived, limit: 100 });
  }

  async create({ userId, input, sourceDeviceId = null }) {
    const row = await this.repository.createPerson({ userId, ...input });
    if (row) await this._record({ userId, row, eventType: 'person.created', sourceDeviceId });
    return row;
  }

  async update({ userId, personId, input, sourceDeviceId = null }) {
    const row = await this.repository.updatePerson({ userId, personId, ...input });
    if (row) await this._record({ userId, row, eventType: row.status === 'archived' ? 'person.archived' : 'person.updated', sourceDeviceId });
    return row;
  }

  listRelationships({ userId, personId = null }) {
    return this.repository.listRelationships({ userId, personId, limit: 100 });
  }

  async createRelationship({ userId, input, sourceDeviceId = null }) {
    const row = await this.repository.createRelationship({ userId, ...input });
    if (row) await this._record({ userId, row, eventType: 'relationship.updated', sourceDeviceId });
    return row;
  }

  listProjectLinks({ userId, projectId = null, personId = null }) {
    return this.repository.listProjectLinks({ userId, projectId, personId, limit: 100 });
  }

  createProjectLink({ userId, input }) {
    return this.repository.createProjectLink({ userId, ...input });
  }

  async _record({ userId, row, eventType, sourceDeviceId }) {
    if (!this.gateway) return;
    await this.gateway.record({
      userId, eventType, occurredAt: this.now(), sourceChannel: 'life_os',
      sourceRef: `${eventType}:${row.id}:revision:${row.revision || 1}`, sourceDeviceId,
      deduplicationKey: `${eventType}:${row.id}:revision:${row.revision || 1}`,
      summary: eventType === 'relationship.updated' ? 'Связь с человеком обновлена' : 'Карточка человека обновлена',
      structuredData: eventType === 'relationship.updated'
        ? { relationshipId: row.id, personId: row.person_id }
        : { personId: row.id, status: row.status || 'active' },
      trustLevel: 'user', privacyClass: 'personal',
    });
  }
}

module.exports = { PeopleService };
