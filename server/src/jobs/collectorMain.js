const { Pool } = require('pg');
const { loadJobConfig } = require('./jobConfig');
const { JobSearchRepository } = require('./jobSearchRepository');
const { JobDeliveryRepository } = require('./jobDeliveryRepository');
const { JobCollector } = require('./jobCollector');
const { HhClient } = require('./hhClient');
const { CurrencyRates } = require('./currencyRates');

function createCollectorRuntime({ env = process.env, pool, hhClient, currencyRates, clock = () => new Date(), wait } = {}) {
  const config = loadJobConfig(env);
  if (!config.jobSearchEnabled) return { async start() {}, async close() {}, enabled: false };
  if (!pool && !env.DATABASE_URL) throw new Error('Job collector requires DATABASE_URL');
  const database = pool || new Pool({ connectionString: env.DATABASE_URL });
  const searchRepository = new JobSearchRepository(database);
  let stopping = false, timer = null, running = null;
  const collector = new JobCollector({ searchRepository, deliveryRepository: new JobDeliveryRepository(database),
    hhClient: hhClient || new HhClient({ userAgent: config.hhUserAgent, readCredential: config.hhAppToken }),
    currencyRates: currencyRates || new CurrencyRates(), now: clock, wait, shouldStop: () => stopping });
  const tick = () => {
    if (stopping || running) return running;
    running = (async () => {
      const users = await searchRepository.dueUsers({ now: clock() });
      for (const row of users) { if (stopping) break; await collector.runOnce({ userId: row.user_id }); }
    })().finally(() => { running = null; });
    return running;
  };
  return { enabled: true, tick,
    async start() {
      if (timer) return;
      await database.query('SELECT 1 FROM job_searches LIMIT 0');
      timer = setInterval(() => { void tick().catch(() => process.stderr.write('JOB_COLLECTOR_TICK_FAILED\n')); }, 10000);
      await tick();
    },
    async close() { stopping = true; if (timer) clearInterval(timer); timer = null;
      if (running) await running.catch(() => {}); if (!pool) await database.end(); },
  };
}

if (require.main === module) {
  let runtime;
  try {
    runtime = createCollectorRuntime();
    const close = () => { void runtime.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', close); process.once('SIGINT', close);
    void runtime.start().catch(() => { process.stderr.write('JOB_COLLECTOR_START_FAILED\n'); process.exitCode = 1; return runtime.close(); });
  } catch { process.stderr.write('JOB_COLLECTOR_CONFIG_FAILED\n'); process.exitCode = 1; }
}
module.exports = { createCollectorRuntime };
