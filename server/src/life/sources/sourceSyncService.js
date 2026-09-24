const { createHash } = require('node:crypto');

function failureCode(error) {
  const code = String(error?.publicCode || 'SOURCE_SYNC_FAILED');
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'SOURCE_SYNC_FAILED';
}

class SourceSyncService {
  constructor(options = {}) { this.repository = options.repository; this.registry = options.registry; this.gateway = options.gateway; this.enabled = options.enabled === true; this.now = options.now || (() => new Date()); this.maxPageBytes = options.maxPageBytes || 256 * 1024; }

  async sync({ userId, connectionId }) {
    if (!this.enabled) return { status: 'fixture_disabled', accepted: 0 };
    const connection = await this.repository.get({ userId, connectionId });
    if (!connection || !connection.enabled) return { status: 'disabled', accepted: 0 };
    const adapter = this.registry.require(connection.adapter_type);
    await this.repository.ensureCursor({ userId, connectionId, adapterSchemaVersion: adapter.schemaVersion });
    const claim = await this.repository.claimCursor({ userId, connectionId, staleBefore: new Date(this.now().getTime() - 5 * 60000) });
    if (!claim) return { status: 'busy', accepted: 0 };
    try {
      const page = await adapter.fetchPage({ cursor: claim.cursor.cursor_value, scope: connection.selected_scope, limit: 50 });
      if (!page || !Array.isArray(page.items) || page.items.length > 50 || Buffer.byteLength(JSON.stringify(page), 'utf8') > this.maxPageBytes) throw Object.assign(new Error('invalid source page'), { publicCode: 'SOURCE_PAGE_INVALID' });
      let accepted = 0;
      for (const item of page.items) {
        if (Buffer.byteLength(JSON.stringify(item), 'utf8') > 32 * 1024) throw Object.assign(new Error('source item too large'), { publicCode: 'SOURCE_ITEM_TOO_LARGE' });
        const normalized = adapter.parse(item);
        const event = await this.gateway.record({ userId, eventType: 'source.synced', occurredAt: normalized.occurredAt,
          sourceChannel: adapter.type, sourceRef: `${adapter.type}:${normalized.externalRef}`,
          deduplicationKey: `source:${adapter.type}:${createHash('sha256').update(`${connectionId}\0${normalized.externalRef}`).digest('hex')}`,
          summary: normalized.summary, structuredData: normalized.structuredData,
          confidence: normalized.confidence, trustLevel: 'inferred', privacyClass: 'personal' });
        if (!event) throw Object.assign(new Error('event unavailable'), { publicCode: 'SOURCE_EVENT_UNAVAILABLE' });
        accepted += 1;
      }
      const cursor = await this.repository.commitCursor({ userId, connectionId, claimToken: claim.claimToken,
        cursorValue: page.nextCursor || claim.cursor.cursor_value, adapterSchemaVersion: adapter.schemaVersion });
      if (!cursor) throw Object.assign(new Error('cursor conflict'), { publicCode: 'SOURCE_CURSOR_CONFLICT' });
      await this.repository.recordHealth({ userId, connectionId, status: 'healthy' });
      return { status: page.done ? 'complete' : 'more', accepted };
    } catch (error) {
      await this.repository.releaseCursor({ userId, connectionId, claimToken: claim.claimToken }).catch(() => false);
      await this.repository.recordHealth({ userId, connectionId, status: 'failed', failureCode: failureCode(error) }).catch(() => false);
      return { status: 'failed', accepted: 0, code: failureCode(error) };
    }
  }
}

module.exports = { SourceSyncService, failureCode };
