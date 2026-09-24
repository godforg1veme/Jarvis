class RetentionWorker {
  constructor(options) { this.repository = options.repository; this.incidentEngine = options.incidentEngine; this.intervalMs = options.intervalMs || 3600000; this.logger = options.logger; this.timer = null; this.running = false; }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runOnce() {
    if (this.running) return;
    this.running = true;
    let healthy = false;
    try { await this.repository.applyRetention(); healthy = true; }
    catch (_) { if (this.logger) this.logger.warn('Operations retention failed'); }
    finally {
      try { if (this.incidentEngine) await this.incidentEngine.observe({ id: null, serviceKey: 'retention', failureKind: 'retention_failed', displayName: 'Очистка истории', summary: 'Не удалось выполнить очистку истории мониторинга', sourceState: healthy ? 'active' : 'failed', healthState: healthy ? 'healthy' : 'unavailable' }); }
      catch (_) { /* Database failure can also prevent recording its incident. */ }
      this.running = false;
    }
  }
}
module.exports = { RetentionWorker };
