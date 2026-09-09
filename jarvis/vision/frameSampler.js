const DEFAULT_SOURCE_INTERVAL_MS = 2000;
const DEFAULT_FOCUSED_INTERVAL_MS = 500;
const DEFAULT_GLOBAL_LIMIT_PER_MINUTE = 30;
const DEFAULT_TEMPORAL_LIMIT_PER_MINUTE = 24;

class FrameSampler {
  constructor(options = {}) {
    this.sourceIntervalMs = Number(options.sourceIntervalMs || DEFAULT_SOURCE_INTERVAL_MS);
    this.focusedIntervalMs = Number(options.focusedIntervalMs || DEFAULT_FOCUSED_INTERVAL_MS);
    this.globalLimitPerMinute = Number(options.globalLimitPerMinute || DEFAULT_GLOBAL_LIMIT_PER_MINUTE);
    this.temporalLimitPerMinute = Number(options.temporalLimitPerMinute || DEFAULT_TEMPORAL_LIMIT_PER_MINUTE);
    this.lastBySource = new Map();
    this.lastFocusedBySource = new Map();
    this.sentAt = [];
    this.temporalSentAt = [];
  }

  _prune(now) {
    const cutoff = now - 60000;
    while (this.sentAt.length && this.sentAt[0] <= cutoff) this.sentAt.shift();
    while (this.temporalSentAt.length && this.temporalSentAt[0] <= cutoff) this.temporalSentAt.shift();
  }

  reset() {
    this.lastBySource.clear();
    this.lastFocusedBySource.clear();
    this.sentAt = [];
    this.temporalSentAt = [];
  }

  consider({ sourceId, mode = 'temporal', at = Date.now() }) {
    const id = String(sourceId || '').trim();
    if (!id) throw new Error('vision source id is required');
    const now = Number(at);
    if (!Number.isFinite(now)) throw new Error('vision sample time is invalid');
    this._prune(now);
    if (mode === 'focused') {
      const previousFocused = this.lastFocusedBySource.get(id) || 0;
      if (previousFocused && now - previousFocused < this.focusedIntervalMs) {
        return { send: false, reason: 'focused_rate_limit' };
      }
      if (this.sentAt.length >= this.globalLimitPerMinute) {
        return { send: false, reason: 'global_rate_limit' };
      }
      this.lastFocusedBySource.set(id, now);
      this.lastBySource.set(id, now);
      this.sentAt.push(now);
      return { send: true, reason: 'focused_priority' };
    }
    if (mode !== 'temporal') throw new Error('vision capture mode is invalid');
    if (this.temporalSentAt.length >= this.temporalLimitPerMinute) {
      return { send: false, reason: 'temporal_rate_limit' };
    }
    if (this.sentAt.length >= this.globalLimitPerMinute) {
      return { send: false, reason: 'global_rate_limit' };
    }
    const previous = this.lastBySource.get(id) || 0;
    if (previous && now - previous < this.sourceIntervalMs) {
      return { send: false, reason: 'source_rate_limit' };
    }
    this.lastBySource.set(id, now);
    this.sentAt.push(now);
    this.temporalSentAt.push(now);
    return { send: true, reason: 'temporal_budget' };
  }
}

module.exports = {
  DEFAULT_FOCUSED_INTERVAL_MS,
  DEFAULT_GLOBAL_LIMIT_PER_MINUTE,
  DEFAULT_SOURCE_INTERVAL_MS,
  DEFAULT_TEMPORAL_LIMIT_PER_MINUTE,
  FrameSampler,
};
