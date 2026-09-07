class OperationRecoveryWorker {
  constructor(options) { this.service = options.service; this.logger = options.logger; this.intervalMs = options.intervalMs || 30000; this.timer = null; this.running = false; }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs); void this.runOnce(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runOnce() { if (this.running) return; this.running = true; try { await this.service.reconcile(); } catch (error) { if (this.logger) this.logger.warn({ err: error }, 'operations reconciliation failed'); } finally { this.running = false; } }
}
module.exports = { OperationRecoveryWorker };
