const { trackWorker } = require('../lifecycle');
const { jobTransaction } = require('./jobTransaction');

async function recoverJobGenerations(pool) {
  return jobTransaction(pool, async (client) => {
    const interrupted = (await client.query(`UPDATE job_tasks SET status='unknown'
      WHERE kind='generate' AND status='running' AND created_at<now()-interval '3 minutes' RETURNING user_id,request_id`)).rows;
    for (const task of interrupted) await client.query(`INSERT INTO job_usage(user_id,request_id,outcome)
      VALUES($1,$2,'pending') ON CONFLICT(user_id,request_id) DO NOTHING`, [task.user_id, task.request_id]);
    return interrupted.length;
  });
}
class JobRecoveryWorker {
  constructor({ pool, applicationRepository, intervalMs = 30000 }) {
    Object.assign(this, { pool, applicationRepository, intervalMs });
    this.timer = null; this.inFlight = null;
    trackWorker(this, 'tick');
  }
  tick() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      await this.applicationRepository.recoverSending();
      await recoverJobGenerations(this.pool);
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async start() {
    this.stopping = false;
    await this.tick();
    if (this.stopping) return;
    if (!this.timer) {
      this.timer = setInterval(() => { void this.tick().catch(() => {}); }, this.intervalMs);
      this.timer.unref?.();
    }
  }
  stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  close() { return this.stop(); }
}
module.exports = { recoverJobGenerations, JobRecoveryWorker };
