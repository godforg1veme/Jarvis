const { listMigrationFiles } = require('../../db/migrate');

class HealthCheckWorker {
  constructor({ pool, repository, hostId, incidentEngine, provider, getPollingHealth, logger }) {
    Object.assign(this, { pool, repository, hostId, incidentEngine, provider, getPollingHealth, logger });
    this.running = false; this.timer = null; this.startedAt = Date.now();
  }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.runOnce(); }, 30000); void this.runOnce(); } }
  stop() { clearInterval(this.timer); this.timer = null; }
  async save(key, healthy, summary, immediate = false) {
    await this.pool.query(`INSERT INTO ops_health_checks(host_id,check_key,state,summary) VALUES($1,$2,$3,$4)
      ON CONFLICT(host_id,check_key) DO UPDATE SET state=EXCLUDED.state,summary=EXCLUDED.summary,checked_at=now()`,
    [this.hostId, key, healthy ? 'healthy' : 'unavailable', summary]);
    await this.incidentEngine.observe({ id: null, serviceKey: key, displayName: summary, summary,
      failureKind: `check_${key}`, healthState: healthy ? 'healthy' : 'unavailable', sourceState: healthy ? 'active' : immediate ? 'failed' : 'unknown' });
  }
  async probeProvider() {
    if (!this.provider) return;
    const claim = await this.pool.query(`
      INSERT INTO ops_health_checks(host_id,check_key,state,summary,next_run_at)
      VALUES($1,'provider','unknown','Проверка модели',now()+interval '6 hours')
      ON CONFLICT(host_id,check_key) DO UPDATE SET next_run_at=now()+interval '6 hours'
      WHERE ops_health_checks.next_run_at IS NULL OR ops_health_checks.next_run_at<=now()
      RETURNING check_key`, [this.hostId]);
    if (claim.rowCount === 0) {
      const previous = await this.pool.query("SELECT state,summary FROM ops_health_checks WHERE host_id=$1 AND check_key='provider'", [this.hostId]);
      const row = previous.rows[0];
      if (row && row.state === 'unavailable') await this.incidentEngine.observe({ id: null, serviceKey: 'provider', failureKind: 'check_provider', displayName: row.summary, summary: row.summary, sourceState: 'failed', healthState: 'unavailable' });
      return;
    }
    let healthy = false;
    try {
      const answer = await this.provider.answer({ messages: [{ role: 'user', content: 'Health check. Reply only OK.' }] });
      healthy = typeof answer === 'string' && answer.trim().length > 0;
    } catch (_) { /* Never retain model responses, provider errors or credentials. */ }
    await this.save('provider', healthy, healthy ? 'Настроенная модель отвечает' : 'Настроенная модель не отвечает', true);
  }
  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const migrations = await this.pool.query('SELECT name FROM schema_migrations');
      const applied = new Set(migrations.rows.map((row) => row.name));
      const ready = listMigrationFiles().every((name) => applied.has(name));
      await this.save('database', ready, ready ? 'База данных и миграции готовы' : 'Не все миграции применены');
      const queue = await this.pool.query("SELECT count(*)::int AS stuck FROM jobs WHERE status='running' AND locked_at < now()-interval '15 minutes'");
      await this.save('queues', queue.rows[0].stuck === 0, queue.rows[0].stuck === 0 ? 'Зависших фоновых заданий нет' : 'Есть задания, выполняющиеся более 15 минут');
      if (this.getPollingHealth && Date.now() - this.startedAt > 90000) {
        const polling = this.getPollingHealth();
        const healthy = Boolean(polling && polling.ok && Date.now() - polling.at < 90000);
        await this.save('telegram', healthy, healthy ? 'Telegram получает обновления' : 'Нет свежего успешного опроса Telegram');
      }
      await this.probeProvider();
    } catch (_) { if (this.logger) this.logger.warn('Operations health checks unavailable'); }
    finally { this.running = false; }
  }
}
module.exports = { HealthCheckWorker };
