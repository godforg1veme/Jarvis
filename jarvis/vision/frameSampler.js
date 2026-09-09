const DEFAULT_SOURCE_INTERVAL_MS = 2000;
const DEFAULT_FOCUSED_INTERVAL_MS = 500;
const DEFAULT_GLOBAL_LIMIT_PER_MINUTE = 30;

class FrameSampler {
  constructor(options = {}) {
    this.sourceIntervalMs = Number(options.sourceIntervalMs || DEFAULT_SOURCE_INTERVAL_MS);
    this.focusedIntervalMs = Number(options.focusedIntervalMs || DEFAULT_FOCUSED_INTERVAL_MS);
    this.globalLimitPerMinute = Number(options.globalLimitPerMinute || DEFAULT_GLOBAL_LIMIT_PER_MINUTE);
    this.lastBySource = new Map();
    this.lastFocusedAt = 0;
    this.sentAt = [];
  }

  _prune(now) {
    const cutoff = now - 60000;
    while (this.sentAt.length && this.sentAt[0] <= cutoff) this.sentAt.shift();
  }

  consider({ sourceId, mode = 'temporal', at = Date.now() }) {
    const id = String(sourceId || '').trim();
    if (!id) throw new Error('vision source id is required');
    const now = Number(at);
    if (!Number.isFinite(now)) throw new Error('vision sample time is invalid');
    this._prune(now);
    if (this.sentAt.length >= this.globalLimitPerMinute) {
      return { send: false, reason: 'global_rate_limit' };
    }
    if (mode === 'focused') {
      if (this.lastFocusedAt && now - this.lastFocusedAt < this.focusedIntervalMs) {
        return { send: false, reason: 'focused_rate_limit' };
      }
      this.lastFocusedAt = now;
      this.lastBySource.set(id, now);
      this.sentAt.push(now);
      return { send: true, reason: 'focused_priority' };
    }
    if (mode !== 'temporal') throw new Error('vision capture mode is invalid');
    const previous = this.lastBySource.get(id) || 0;
    if (previous && now - previous < this.sourceIntervalMs) {
      return { send: false, reason: 'source_rate_limit' };
    }
    this.lastBySource.set(id, now);
    this.sentAt.push(now);
    return { send: true, reason: 'temporal_budget' };
  }
}

module.exports = {
  DEFAULT_FOCUSED_INTERVAL_MS,
  DEFAULT_GLOBAL_LIMIT_PER_MINUTE,
  DEFAULT_SOURCE_INTERVAL_MS,
  FrameSampler,
};

