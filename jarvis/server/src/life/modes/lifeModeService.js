const { modeSelectionSchema } = require('./lifeModeSchemas');
const { getLifeModePolicy } = require('./lifeModePolicy');

class LifeModeService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway || null;
    this.now = options.now || (() => new Date());
  }

  async get({ userId }) {
    const now = this.now();
    let row = await this.repository.get({ userId });
    if (row?.expires_at && new Date(row.expires_at) <= now) {
      row = await this.repository.restoreExpired({ userId, now }) || await this.repository.get({ userId });
    }
    return this._result(row, now);
  }

  async setManual({ userId, input, sourceDeviceId = null }) {
    return this._set({ userId, input, source: 'manual', sourceDeviceId });
  }

  async acceptSuggestion({ userId, input, sourceDeviceId = null }) {
    return this._set({ userId, input, source: 'accepted_suggestion', sourceDeviceId });
  }

  async _set({ userId, input, source, sourceDeviceId }) {
    const selection = modeSelectionSchema.parse(input);
    const current = await this.repository.get({ userId });
    if (current && selection.revision == null) return null;
    const now = this.now();
    const row = await this.repository.set({
      userId, mode: selection.mode, source, startsAt: now.toISOString(),
      expiresAt: selection.expiresAt || null, revision: selection.revision ?? null,
    });
    if (!row) return null;
    if (this.gateway) await this.gateway.record({
      userId, eventType: 'mode.changed', occurredAt: now, sourceChannel: 'life_os',
      sourceRef: `mode:${row.id}:revision:${row.revision}`, sourceDeviceId,
      deduplicationKey: `mode:${row.id}:revision:${row.revision}`,
      summary: `Режим Life OS изменён на ${row.mode}`,
      structuredData: { mode: row.mode, source: row.source, revision: row.revision },
      trustLevel: 'user', privacyClass: 'personal',
    });
    return this._result(row, now);
  }

  _result(row, now) {
    if (!row) return { mode: 'work', source: 'default', startsAt: null, expiresAt: null, revision: null, policy: getLifeModePolicy('work') };
    return {
      mode: row.mode, source: row.source, startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      revision: row.revision, expired: Boolean(row.expires_at && new Date(row.expires_at) <= now),
      policy: getLifeModePolicy(row.mode),
    };
  }
}

module.exports = { LifeModeService };
