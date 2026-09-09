const crypto = require('node:crypto');
const { VISION_SOURCE_TYPES, requiredId, validateVisionSource } = require('./visionSchemas');

class VisualSourceRegistry {
  constructor(options = {}) {
    this.createId = options.createId || (() => `source-${crypto.randomUUID()}`);
    this.sources = new Map();
    this.nativeToId = new Map();
  }

  upsert(input = {}) {
    const type = String(input.type || '').trim();
    if (!VISION_SOURCE_TYPES.includes(type)) throw new Error('vision source type is invalid');
    const nativeId = String(input.nativeId || '').trim();
    if (!nativeId || nativeId.length > 512) throw new Error('native vision source id is invalid');
    const nativeKey = `${type}:${nativeId}`;
    const existingId = this.nativeToId.get(nativeKey);
    const sourceId = requiredId(existingId || input.sourceId || this.createId(), 'vision source id');
    const label = String(input.label || '').trim().slice(0, 160);
    const record = {
      sourceId,
      nativeId,
      type,
      label,
      displayIndex: input.displayIndex === undefined ? undefined : Number(input.displayIndex),
      active: input.active === true,
      available: input.available !== false,
      protected: input.protected === true,
      updatedAt: Number(input.updatedAt || Date.now()),
    };
    validateVisionSource(record.displayIndex === undefined ? {
      sourceId, type, active: record.active, available: record.available, protected: record.protected,
    } : {
      sourceId, type, displayIndex: record.displayIndex, active: record.active,
      available: record.available, protected: record.protected,
    });
    this.sources.set(sourceId, record);
    this.nativeToId.set(nativeKey, sourceId);
    return this.getLocal(sourceId);
  }

  markUnavailableMissing(type, nativeIds = []) {
    const allowed = new Set(nativeIds.map((value) => String(value)));
    for (const source of this.sources.values()) {
      if (source.type === type && !allowed.has(source.nativeId)) {
        source.available = false;
        source.active = false;
        source.updatedAt = Date.now();
      }
    }
  }

  setActive(sourceIds = []) {
    if (!Array.isArray(sourceIds) || sourceIds.length > 4) throw new Error('active vision sources are invalid');
    const selected = sourceIds.map((sourceId) => this.requireLocal(sourceId));
    if (selected.some((source) => !source.available || source.protected)) throw new Error('vision source is unavailable');
    if (selected.filter((source) => source.type === 'camera').length > 1) {
      throw new Error('only one camera may be active');
    }
    const ids = new Set(selected.map((source) => source.sourceId));
    for (const source of this.sources.values()) source.active = ids.has(source.sourceId);
    return this.listPublic();
  }

  requireLocal(sourceId) {
    const source = this.sources.get(requiredId(sourceId, 'vision source id'));
    if (!source) throw new Error('vision source is unknown');
    return { ...source };
  }

  getLocal(sourceId) {
    const source = this.sources.get(String(sourceId || ''));
    return source ? { ...source } : null;
  }

  listLocal() {
    return [...this.sources.values()].map((source) => ({ ...source }));
  }

  listPublic() {
    return [...this.sources.values()].map((source) => validateVisionSource({
      sourceId: source.sourceId,
      type: source.type,
      ...(source.displayIndex === undefined ? {} : { displayIndex: source.displayIndex }),
      active: source.active,
      available: source.available,
      protected: source.protected,
    }));
  }
}

module.exports = { VisualSourceRegistry };

