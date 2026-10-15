const { z } = require('zod');

const schema = z.object({
  jobSearchEnabled: z.boolean(),
  jobCollectorIntervalMs: z.number().int().min(60000).max(86400000),
  jobHistoryDays: z.number().int().min(1).max(30),
  jobBudgetUsd: z.number().finite().positive().max(10000),
  jobSearchModel: z.string().max(255),
  jobSecretKey: z.string().max(128),
  jobPublicOrigin: z.string().max(2048),
  hhClientId: z.string().max(255), hhClientSecret: z.string().max(2048),
  hhAppToken: z.string().max(4096),
  hhUserAgent: z.string().max(255),
  jobBrowserUrl: z.string().max(255), jobBrowserOwnerId: z.string().max(100), jobBrowserToken: z.string().max(256),
});

function loadJobConfig(env) {
  const config = schema.parse({
    jobSearchEnabled: ['true', '1', 'yes', 'on'].includes(String(env.JARVIS_JOB_SEARCH_ENABLED || '').toLowerCase()),
    jobCollectorIntervalMs: Number(env.JARVIS_JOB_COLLECTOR_INTERVAL_MS || 1800000),
    jobHistoryDays: Number(env.JARVIS_JOB_HISTORY_DAYS || 14),
    jobBudgetUsd: Number(env.JARVIS_JOB_BUDGET_USD || 3),
    jobSearchModel: String(env.JARVIS_JOB_MODEL || '').trim(),
    jobSecretKey: String(env.JARVIS_JOB_SECRET_KEY || '').trim(),
    jobPublicOrigin: String(env.JARVIS_JOB_PUBLIC_ORIGIN || '').trim(),
    hhClientId: String(env.HH_CLIENT_ID || '').trim(),
    hhClientSecret: String(env.HH_CLIENT_SECRET || '').trim(),
    hhAppToken: String(env.HH_APP_TOKEN || '').trim(),
    hhUserAgent: String(env.HH_USER_AGENT || 'JarvisJobSearch/1.0').trim(),
    jobBrowserUrl: String(env.JARVIS_JOB_BROWSER_URL || 'http://job-browser:8080').trim(),
    jobBrowserOwnerId: String(env.JARVIS_JOB_BROWSER_OWNER_ID || '').trim(),
    jobBrowserToken: String(env.JARVIS_JOB_BROWSER_TOKEN || '').trim(),
  });
  if (config.jobSecretKey && (!/^[a-f\d]{64}$/i.test(config.jobSecretKey)
    && !/^[\w-]{43}$/.test(config.jobSecretKey))) throw new Error('Invalid job secret key');
  if (config.jobPublicOrigin) {
    const url = new URL(config.jobPublicOrigin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.protocol !== 'https:' && !(env.NODE_ENV === 'test' && url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
      throw new Error('Job public origin must be an HTTPS origin');
    }
  }
  return config;
}

module.exports = { loadJobConfig };
