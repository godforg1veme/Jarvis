const crypto = require('node:crypto');

// Store operational summaries only. Arbitrary log bodies can contain family
// documents, SQL values, parser findings and credentials, so they never enter
// the panel archive.
function normalizeOperationalLogs(output, now = new Date()) {
  const entries = [];
  for (const line of String(output || '').split(/\r?\n/).slice(-100)) {
    let body = line; let level = null;
    const start = line.indexOf('{');
    if (start >= 0) try { const row = JSON.parse(line.slice(start)); level = row.level; body = String(row.msg || ''); } catch (_) {}
    const error = Number(level) >= 50 || /\b(error|fatal|critical|failed|panic)\b/i.test(body);
    const warning = Number(level) === 40 || /\bwarn(?:ing)?\b/i.test(body);
    const lifecycle = /\b(started|starting|stopped|shutdown|listening|connected|disconnected)\b/i.test(body);
    if (!error && !warning && !lifecycle) continue;
    const match = line.match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)/);
    const parsed = match ? new Date(match[0]) : now;
    const observedAt = Number.isNaN(parsed.getTime()) ? now : parsed;
    const message = error ? 'В журнале сервиса зафиксирована ошибка' : warning ? 'В журнале сервиса зафиксировано предупреждение' : 'Изменение состояния процесса';
    entries.push({ observedAt, message, priority: error ? 3 : warning ? 4 : 6,
      byteSize: Buffer.byteLength(message), fingerprint: crypto.createHash('sha256').update(`${observedAt.toISOString()}:${message}`).digest('hex') });
  }
  return entries;
}

class LogCollector {
  constructor({ client, repository, hostId, logger }) { Object.assign(this, { client, repository, hostId, logger }); this.running = false; this.timer = null; }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.runOnce(); }, 60000); void this.runOnce(); } }
  stop() { clearInterval(this.timer); this.timer = null; }
  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const services = await this.repository.listServices(this.hostId);
      for (const service of services) {
        const response = await this.client.request({ version: 1, requestId: crypto.randomUUID(), operation: 'service.logs.read',
          arguments: { serviceId: service.key, maxLines: 100, after: new Date(Date.now() - 120000).toISOString() }, sentAt: new Date().toISOString() });
        if (response.result.state !== 'succeeded') continue;
        const entries = normalizeOperationalLogs(response.result.data?.output);
        await this.repository.recordLogEntries({ hostId: this.hostId, serviceId: service.id, source: service.key === 'telegram-parser' ? 'journald' : 'docker', entries });
      }
    } catch (_) { if (this.logger) this.logger.warn('Operational log collection unavailable'); }
    finally { this.running = false; }
  }
}
module.exports = { LogCollector, normalizeOperationalLogs };
