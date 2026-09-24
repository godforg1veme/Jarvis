class CommandWorker {
  constructor(options = {}) {
    this.repository = options.repository;
    this.logger = options.logger || null;
    this.intervalMs = Math.min(Math.max(Number(options.intervalMs || 5000), 1000), 60000);
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    void this.runOnce();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.running || !this.repository || typeof this.repository.expireStale !== 'function') return;
    this.running = true;
    try {
      await this.repository.expireStale();
    } catch (error) {
      if (this.logger && typeof this.logger.warn === 'function') this.logger.warn({ err: error }, 'command expiry sweep failed');
    } finally {
      this.running = false;
    }
  }
}

module.exports = { CommandWorker };
