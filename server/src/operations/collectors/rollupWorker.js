class RollupWorker {
  constructor(options) { this.repository = options.repository; this.intervalMs = options.intervalMs || 300000; this.logger = options.logger; this.timer = null; this.running = false; }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs); void this.runOnce(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runOnce() { if (this.running) return; this.running = true; try { await this.repository.rollupMetrics(); } catch (error) { if (this.logger) this.logger.warn({ err: error }, 'operations metric rollup failed'); } finally { this.running = false; } }
}
module.exports = { RollupWorker };
