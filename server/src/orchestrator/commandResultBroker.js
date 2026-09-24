const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'expired']);

class CommandResultBroker {
  constructor(options = {}) {
    this.waiters = new Map();
    this.recent = new Map();
    this.now = options.now || (() => Date.now());
    this.cacheMs = options.cacheMs || 30000;
    this.logger = options.logger || null;
    this.listeners = new Set();
  }

  notify(command) {
    if (!command || !command.id || !TERMINAL_STATUSES.has(command.status)) return false;
    this._prune();
    this.recent.set(command.id, { command, expiresAt: this.now() + this.cacheMs });
    const waiters = this.waiters.get(command.id) || [];
    this.waiters.delete(command.id);
    for (const waiter of waiters) waiter.resolve(command);
    for (const listener of this.listeners) {
      queueMicrotask(() => Promise.resolve(listener(command)).catch((error) => {
        if (this.logger) this.logger.error({ err: error, commandId: command.id }, 'command result listener failed');
      }));
    }
    return waiters.length > 0;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('result listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async wait(commandId, options = {}) {
    const id = String(commandId || '');
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 5000, 1), 60000);
    this._prune();
    const cached = this.recent.get(id);
    if (cached) return cached.command;
    if (typeof options.load === 'function') {
      const current = await options.load();
      if (current && TERMINAL_STATUSES.has(current.status)) return current;
    }
    return new Promise((resolve) => {
      const waiter = { resolve: (value) => { clearTimeout(waiter.timer); resolve(value); } };
      waiter.timer = setTimeout(() => {
        const current = this.waiters.get(id) || [];
        const remaining = current.filter((entry) => entry !== waiter);
        if (remaining.length) this.waiters.set(id, remaining);
        else this.waiters.delete(id);
        resolve(null);
      }, timeoutMs);
      const entries = this.waiters.get(id) || [];
      entries.push(waiter);
      this.waiters.set(id, entries);
    });
  }

  _prune() {
    const now = this.now();
    for (const [id, entry] of this.recent) {
      if (entry.expiresAt <= now) this.recent.delete(id);
    }
  }
}

module.exports = { CommandResultBroker, TERMINAL_STATUSES };
