class RateLimitError extends Error {
  constructor() {
    super('rate limit exceeded');
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.publicCode = 'RATE_LIMITED';
  }
}

class FixedWindowRateLimiter {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.maxEntries = options.maxEntries ?? 10000;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new TypeError('invalid rate limiter capacity');
    this.entries = new Map();
    this.sweepCursor = this.entries.entries();
  }

  sweep(now) {
    // Bound work per request, even with many distinct keys and window lengths.
    const budget = Math.min(64, this.entries.size);
    for (let i = 0; i < budget; i += 1) {
      let item = this.sweepCursor.next();
      if (item.done) {
        this.sweepCursor = this.entries.entries();
        item = this.sweepCursor.next();
      }
      if (item.done) break;
      const [key, entry] = item.value;
      if (now >= entry.resetAt) this.entries.delete(key);
    }
  }

  getStats() {
    return { entries: this.entries.size, maxEntries: this.maxEntries };
  }

  check(key, options = {}) {
    const limit = Number(options.limit || 10);
    const windowMs = Number(options.windowMs || 60000);
    const value = String(key || '');
    const now = this.now();
    this.sweep(now);
    const existing = this.entries.get(value);
    // Never evict a live counter: a full store must not reset another key's limit.
    if (!existing && this.entries.size >= this.maxEntries) throw new RateLimitError();
    const current = !existing || now >= existing.resetAt
      ? { count: 0, resetAt: now + windowMs }
      : existing;
    current.count += 1;
    this.entries.set(value, current);
    if (current.count > limit) throw new RateLimitError();
    return { remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
  }
}

module.exports = { FixedWindowRateLimiter, RateLimitError };
