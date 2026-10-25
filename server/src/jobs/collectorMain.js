const { Pool } = require('pg');
const { loadJobConfig } = require('./jobConfig');
const { JobSearchRepository } = require('./jobSearchRepository');
const { JobDeliveryRepository } = require('./jobDeliveryRepository');
const { JobCollector } = require('./jobCollector');
const { JobBrowserClient } = require('./jobBrowserClient');
const { CurrencyRates } = require('./currencyRates');
const { configuredOwnerJobAccess } = require('./configuredOwnerJobAccess');
const { JobCollectionScheduler } = require('./jobCollectionScheduler');

function createCollectorRuntime({ env = process.env, pool, hhClient, currencyRates, clock = () => new Date(), wait } = {}) {
  const config = loadJobConfig(env);
  if (!config.jobSearchEnabled) return { async start() {}, async close() {}, enabled: false };
  if (!/^[1-9]\d{0,19}$/.test(String(env.JARVIS_OPERATIONS_OWNER_TELEGRAM_ID || ''))) {
    throw new Error('JOB_COLLECTOR_OWNER_CONFIG_INVALID');
  }
  if (!pool && !env.DATABASE_URL) throw new Error('Job collector requires DATABASE_URL');
  const source = hhClient || new JobBrowserClient({ baseUrl: config.jobBrowserUrl,
    ownerId: config.jobBrowserOwnerId, token: config.jobBrowserToken });
  const database = pool || new Pool({ connectionString: env.DATABASE_URL });
  const accessService = configuredOwnerJobAccess(database, env.JARVIS_OPERATIONS_OWNER_TELEGRAM_ID);
  const searchRepository = new JobSearchRepository(database, { accessService });
  const freshRepository = new JobSearchRepository(database, { accessService, lane: 'fresh' });
  const reconcileRepository = new JobSearchRepository(database, { accessService, lane: 'reconcile' });
  let stopping = false, timer = null, running = null;
  const collector = new JobCollector({ searchRepository, deliveryRepository: new JobDeliveryRepository(database, { accessService }),
    hhClient: source,
    currencyRates: currencyRates || new CurrencyRates(), now: clock, wait, shouldStop: () => stopping,
    maxRunMs: 15000, maxRequests: 20, captchaEnabled: config.jobCaptchaTelegram });
  const freshCollector = new JobCollector({ searchRepository: freshRepository,
    deliveryRepository: new JobDeliveryRepository(database, { accessService }), hhClient: source,
    currencyRates: collector.currencyRates, now: clock, wait, shouldStop: () => stopping,
    lane: 'fresh', captchaEnabled: config.jobCaptchaTelegram });
  const reconcileCollector = new JobCollector({ searchRepository: reconcileRepository,
    deliveryRepository: new JobDeliveryRepository(database, { accessService }), hhClient: source,
    currencyRates: collector.currencyRates, now: clock, wait, shouldStop: () => stopping,
    lane: 'reconcile', captchaEnabled: config.jobCaptchaTelegram });
  const scheduler = new JobCollectionScheduler({ freshRepository, historyRepository: searchRepository,
    reconcileRepository, freshCollector, historyCollector: collector, reconcileCollector,
    now: clock, shouldStop: () => stopping });
  const tick = () => {
    if (stopping || running) return running;
    running = scheduler.tick().finally(() => { running = null; });
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
