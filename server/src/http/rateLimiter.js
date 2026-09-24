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
    this.entries = new Map();
  }

  check(key, options = {}) {
    const limit = Number(options.limit || 10);
    const windowMs = Number(options.windowMs || 60000);
    const value = String(key || '');
    const now = this.now();
    const existing = this.entries.get(value);
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
