const { JobCaptchaClient } = require('./jobCaptchaClient');
const { JobCaptchaRepository } = require('./jobCaptchaRepository');
const { JobCaptchaService } = require('./jobCaptchaService');
const { JobCaptchaWorker } = require('./jobCaptchaWorker');
const { JobSearchRepository } = require('./jobSearchRepository');
const { JobProfileRepository } = require('./jobProfileRepository');
const { JobDraftRepository } = require('./jobDraftRepository');
const { JobUsageRepository } = require('./jobUsageRepository');
const { JobDeliveryRepository } = require('./jobDeliveryRepository');
const { JobDraftService } = require('./jobDraftService');
const { JobModelAdapter } = require('./jobModelAdapter');
const { JobSettingsService } = require('./jobSettingsService');
const { JobTelegramService } = require('./jobTelegramService');
const { JobDeliveryWorker } = require('./jobDeliveryWorker');
const { JobApplicationRepository } = require('./jobApplicationRepository');
const { JobApplicationService } = require('./jobApplicationService');
const { JobRecoveryWorker } = require('./jobRecovery');
const { JobBrowserClient } = require('./jobBrowserClient');
const { JobBrowserConnectionService } = require('./jobBrowserConnectionService');
const {JobHistoryRepository}=require('./jobHistoryRepository');
const {JobHistorySyncRepository}=require('./jobHistorySyncRepository');
const {JobHistoryWorker}=require('./jobHistoryWorker');
const {JobHistoryTelegram}=require('./jobHistoryTelegram');

function createJobRuntime({ config, pool, interactions, send, sendPhoto, fetchImpl, applicationAdapter = null }) {
  if (!config.jobSearchEnabled) return null;
  let connectionService = null, browserClient = null;
  if (config.jobBrowserOwnerId && config.jobBrowserToken) {
    browserClient = new JobBrowserClient({ baseUrl: config.jobBrowserUrl, ownerId: config.jobBrowserOwnerId,
      token: config.jobBrowserToken, fetchImpl });
    connectionService = new JobBrowserConnectionService({ pool, browserClient });
  }
  if (!applicationAdapter && config.jobBrowserApplyEnabled === true) {
    applicationAdapter = new JobBrowserClient({ baseUrl: config.jobBrowserUrl, ownerId: config.jobBrowserOwnerId,
      token: config.jobBrowserToken, applyToken: config.jobBrowserApplyToken, fetchImpl }).asApplicationAdapter();
  }
  const defaults = {};
  for (const [key, value] of Object.entries({ model: config.jobSearchModel, budgetUsd: config.jobBudgetUsd,
    intervalMs: config.jobCollectorIntervalMs, historyDays: config.jobHistoryDays })) if (value !== undefined) defaults[key] = value;
  const searchRepository = new JobSearchRepository(pool, { defaults });
  const profileRepository = new JobProfileRepository(pool);
  const draftRepository = new JobDraftRepository(pool);
  const usageRepository = new JobUsageRepository(pool);
  const deliveryRepository = new JobDeliveryRepository(pool);
  const draftService = new JobDraftService({ pool, searchRepository, profileRepository, draftRepository, usageRepository,
    modelAdapter: new JobModelAdapter({ config, fetchImpl }), defaultModel: config.jobSearchModel });
  const settingsService = new JobSettingsService({ pool, searchRepository, profileRepository });
  const applicationRepository = new JobApplicationRepository(pool);
  const historyRepository=new JobHistoryRepository(pool);
  const historySync=new JobHistorySyncRepository(pool,historyRepository);
  const historyWorker=browserClient?new JobHistoryWorker({repository:historySync,client:browserClient}):null;
  const historyService=new JobHistoryTelegram({repository:historyRepository,syncRepository:historySync,available:Boolean(browserClient)});
  const applicationService = new JobApplicationService({ pool, repository: applicationRepository, searchRepository, adapter: applicationAdapter, historyRepository });
  if (config.jobCaptchaTelegram && !config.jobCaptchaToken) throw new Error('JOB_CAPTCHA_CONFIG_INVALID');
  let captchaService = null, captchaWorker = null;
  if (config.jobCaptchaTelegram && config.jobCaptchaToken) {
    const client = new JobCaptchaClient({ ownerId: config.jobBrowserOwnerId, token: config.jobCaptchaToken, fetchImpl });
    const repository = new JobCaptchaRepository(pool);
    captchaService = new JobCaptchaService({ repository, client });
    captchaWorker = new JobCaptchaWorker({ repository, client, ownerId: config.jobBrowserOwnerId, sendPhoto });
  }
  const telegramService = new JobTelegramService({ pool, searchRepository, profileRepository, draftRepository,
    usageRepository, interactions, draftService, settingsService, applicationService, connectionService, captchaService, historyService,
    settingsModels: [config.jobSearchModel, config.openrouterModel, config.openrouterFallbackModel], defaultModel: config.jobSearchModel });
  const deliveryWorker = new JobDeliveryWorker({ pool, searchRepository, deliveryRepository, send, captchaEnabled: Boolean(captchaService) });
  const recoveryWorker = new JobRecoveryWorker({ pool, applicationRepository });
  return { captchaService, telegramService, deliveryWorker, applicationService, applicationRepository, historyWorker, historyRepository, historySync,
    async start() { await recoveryWorker.start(); deliveryWorker.start(); captchaWorker?.start(); historyWorker?.start(); },
    async close() { await Promise.all([deliveryWorker.close(), recoveryWorker.close(), captchaWorker?.close(),historyWorker?.close()]); } };
}
module.exports = { createJobRuntime };
