const crypto = require('node:crypto');

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PENDING_MS = 30 * 60 * 1000;
const SECRET_PATTERNS = [
  /\b(?:sk|pk|api)[-_][a-z0-9_-]{12,}\b/giu,
  /\b(?:password|пароль|token|токен|secret|секрет)\s*[:=]\s*\S+/giu,
  /\b\d{13,19}\b/g,
];

function searchableTokens(observation) {
  let text = [observation.sceneSummary, ...(observation.texts || []).filter((item) => !item.sensitive).map((item) => item.text)].join(' ');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, ' ');
  return [...new Set((text.toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]{3,40}/gu) || []).slice(0, 128))];
}

function isVisualMemoryQuery(query) {
  return /(?:видел|видела|видишь|снимок|кадр|камер|экран|монитор|визуаль|раньше\s+было|показывал|помнишь\s+что)/iu.test(String(query || ''));
}

class VisualMemoryService {
  constructor({ repository, storage, quotaBytes = 1024 * 1024 * 1024, blindIndexKey, now = () => Date.now(), logger = console }) {
    this.repository = repository; this.storage = storage; this.quotaBytes = quotaBytes;
    this.blindIndexKey = Buffer.isBuffer(blindIndexKey) ? blindIndexKey : storage.key;
    this.now = now; this.logger = logger;
  }

  tokenHashes(observation) {
    return searchableTokens(observation).map((token) => crypto.createHmac('sha256', this.blindIndexKey).update(token).digest());
  }

  async store({ userId, deviceId, leaseId, image, metadata, observation, sensitiveConsent = null }) {
    const sensitive = observation.sensitivity === 'sensitive';
    if (sensitive && sensitiveConsent === false) {
      return { memoryId: null, state: 'rejected', retentionConsentRequired: false };
    }
    const pending = sensitive && sensitiveConsent !== true;
    const blobKey = this.storage.createBlobKey();
    const aad = { userId, frameId: metadata.frameId, sourceId: metadata.sourceId };
    await this.storage.write(blobKey, { contentType: metadata.contentType, image: image.toString('base64'), observation }, aad);
    let record;
    try {
      const now = this.now();
      record = await this.repository.create({
        userId, deviceId, leaseId, frameId: metadata.frameId, sourceId: metadata.sourceId,
        state: pending ? 'pending_sensitive_consent' : 'stored', sensitivity: observation.sensitivity,
        blobKey, byteLength: image.length, contentHash: crypto.createHash('sha256').update(image).digest(),
        confidence: observation.confidence, capturedAt: metadata.capturedAt,
        expiresAt: pending ? null : new Date(now + RETENTION_MS),
        pendingExpiresAt: pending ? new Date(now + PENDING_MS) : null,
      });
      if (!pending) await this.repository.addTokens({ memoryId: record.id, userId, tokenHashes: this.tokenHashes(observation) });
      await this.enforceQuota(userId);
      return { memoryId: record.id, state: record.state, retentionConsentRequired: pending };
    } catch (error) {
      await this.storage.remove(blobKey).catch((cleanupError) => {
        this.logger.warn({ errorCode: String(cleanupError?.code || cleanupError?.name || 'CLEANUP_FAILED').slice(0, 80) }, 'visual memory rollback cleanup failed');
      });
      throw error;
    }
  }

  async read({ userId, memoryId }) {
    const record = await this.repository.get({ userId, memoryId });
    if (!record || !record.blob_key || !['stored', 'pending_sensitive_consent'].includes(record.state)) return null;
    const payload = await this.storage.read(record.blob_key, { userId, frameId: record.frame_id, sourceId: record.source_id });
    if (record.corrected_summary) payload.observation = { ...payload.observation, sceneSummary: record.corrected_summary, corrected: true };
    return { record, payload };
  }

  async searchForPrompt({ userId, query, limit = 5 }) {
    if (!isVisualMemoryQuery(query)) return [];
    const hashes = searchableTokens({ sceneSummary: query, texts: [] })
      .map((token) => crypto.createHmac('sha256', this.blindIndexKey).update(token).digest());
    let records = await this.repository.searchByTokens({ userId, tokenHashes: hashes, limit });
    if (!records.length) records = await this.repository.latestStored({ userId, limit });
    const results = [];
    for (const record of records) {
      try {
        const payload = await this.storage.read(record.blob_key, { userId, frameId: record.frame_id, sourceId: record.source_id });
        results.push({
          memoryId: record.id, sourceId: record.source_id, capturedAt: record.captured_at,
          summary: record.corrected_summary || payload.observation.sceneSummary,
          objects: (payload.observation.objects || []).slice(0, 20),
          texts: (payload.observation.texts || []).filter((item) => !item.sensitive).slice(0, 20),
        });
      } catch (error) {
        this.logger.warn({ errorCode: String(error?.code || error?.name || 'DECRYPT_FAILED').slice(0, 80), memoryId: record.id }, 'visual memory could not be decrypted for retrieval');
      }
    }
    return results;
  }

  async consent({ userId, leaseId, sourceId, allow }) {
    const pending = await this.repository.pendingForConsent({ userId, leaseId, sourceId });
    const changed = await this.repository.setConsent({ userId, leaseId, sourceId, allow });
    if (!allow) {
      for (const item of pending) {
        await this.storage.remove(item.blob_key);
        await this.repository.clearBlob(item.id);
      }
    }
    if (allow) {
      for (const item of changed) {
        const read = await this.read({ userId, memoryId: item.id });
        if (read) await this.repository.addTokens({ memoryId: item.id, userId, tokenHashes: this.tokenHashes(read.payload.observation) });
      }
    }
    return changed.length;
  }

  async remove({ userId, memoryId }) {
    const record = await this.repository.get({ userId, memoryId });
    if (!record) return false;
    await this.repository.markDeleted({ userId, memoryId });
    await this.storage.remove(record.blob_key);
    await this.repository.clearBlob(memoryId);
    return true;
  }

  async enforceQuota(userId) {
    let total = await this.repository.totalStoredBytes(userId);
    if (total <= this.quotaBytes) return;
    for (const record of await this.repository.evictionCandidates(userId)) {
      await this.repository.markDeleted({ userId, memoryId: record.id });
      await this.storage.remove(record.blob_key);
      await this.repository.clearBlob(record.id);
      total -= Number(record.byte_length || 0);
      if (total <= this.quotaBytes) break;
    }
  }

  async cleanupExpired() {
    const candidates = await this.repository.expirationCandidates();
    for (const record of candidates) {
      if (record.state === 'stored' || record.state === 'pending_sensitive_consent') {
        await this.repository.markExpired(record.id);
      }
      await this.storage.remove(record.blob_key);
      await this.repository.clearBlob(record.id);
    }
    return candidates.length;
  }
}

class VisualMemoryWorker {
  constructor({ service, intervalMs = 60_000, logger = console }) {
    this.service = service; this.intervalMs = intervalMs; this.logger = logger; this.timer = null;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.service.cleanupExpired().catch((error) => this.logger.warn({ errorCode: String(error?.code || error?.name || 'CLEANUP_FAILED').slice(0, 80) }, 'visual memory cleanup failed')), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { PENDING_MS, RETENTION_MS, SECRET_PATTERNS, VisualMemoryService, VisualMemoryWorker, isVisualMemoryQuery, searchableTokens };
