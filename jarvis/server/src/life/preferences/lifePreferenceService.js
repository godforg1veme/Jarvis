const { PREFERENCE_KEYS, parsePreferenceInput } = require('./lifePreferenceSchemas');
const { DEFAULT_PREFERENCES } = require('./lifePreferenceRepository');

class LifePreferenceService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway || null;
    this.now = options.now || (() => new Date());
  }

  async list({ userId }) {
    const rows = await this.repository.list({ userId });
    const byKey = new Map(rows.map((row) => [row.preference_key, row]));
    return PREFERENCE_KEYS.map((key) => this._public(byKey.get(key), key));
  }

  async set({ userId, key, value, revision = null, sourceDeviceId = null }) {
    const input = parsePreferenceInput({ key, value, revision });
    const existing = await this.repository.get({ userId, key: input.key });
    if (existing && input.revision == null) return null;
    const row = await this.repository.setExplicit({ userId, ...input });
    if (!row) return null;
    await this._record({ userId, row, eventType: 'preference.updated', sourceDeviceId });
    return this._public(row, input.key);
  }

  async reset({ userId, key, revision, sourceDeviceId = null }) {
    return this.set({ userId, key, value: DEFAULT_PREFERENCES[key], revision, sourceDeviceId });
  }

  async remove({ userId, key, revision, sourceDeviceId = null }) {
    parsePreferenceInput({ key, value: DEFAULT_PREFERENCES[key], revision });
    const row = await this.repository.remove({ userId, key, revision });
    if (row) await this._record({ userId, row, key, eventType: 'preference.deleted', sourceDeviceId });
    return row;
  }

  async _record({ userId, row, key = null, eventType, sourceDeviceId }) {
    if (!this.gateway) return;
    const preferenceKey = key || row.preference_key;
    await this.gateway.record({
      userId, eventType, occurredAt: this.now(), sourceChannel: 'life_os',
      sourceRef: `preference:${row.id}:revision:${row.revision}`,
      sourceDeviceId, deduplicationKey: `${eventType}:${row.id}:revision:${row.revision}`,
      summary: eventType === 'preference.deleted' ? 'Настройка Life OS удалена' : 'Настройка Life OS обновлена',
      structuredData: { key: preferenceKey, source: row.source || 'explicit', revision: row.revision },
      trustLevel: 'user', privacyClass: 'personal',
    });
  }

  _public(row, key) {
    if (!row) return {
      key, value: DEFAULT_PREFERENCES[key], source: 'default', explanation: '',
      evidenceCount: 0, confidence: 1, revision: null,
    };
    return {
      key: row.preference_key, value: row.value, source: row.source,
      explanation: row.explanation || '', evidenceCount: row.evidence_count || 0,
      confidence: Number(row.confidence ?? 1), revision: row.revision,
    };
  }
}

module.exports = { LifePreferenceService };
