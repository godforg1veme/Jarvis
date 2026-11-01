const { createResourceCloser } = require('../lifecycle');
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
const { JobConnectionSessionRepository } = require('./jobConnectionSessionRepository');
const { JobConnectionSessionService } = require('./jobConnectionSessionService');
const { JobLoginLinkDelivery } = require('./jobLoginLinkDelivery');
const {JobHistoryRepository}=require('./jobHistoryRepository');
const {JobHistorySyncRepository}=require('./jobHistorySyncRepository');
const {JobHistoryWorker}=require('./jobHistoryWorker');
const {JobHistoryTelegram}=require('./jobHistoryTelegram');
const { configuredOwnerJobAccess } = require('./configuredOwnerJobAccess');
const { JobResumeRepository } = require('./jobResumeRepository');
const { JobResumeService } = require('./jobResumeService');
const { JobResumeWorker } = require('./jobResumeWorker');
const { JobResumeContextService } = require('./jobResumeContextService');
const { JobAutomationRepository } = require('./jobAutomationRepository');
const { JobAutomationService } = require('./jobAutomationService');
const { JobAutomationWorker } = require('./jobAutomationWorker');

function createJobRuntime({ config, pool, interactions, send, sendPhoto, fetchImpl, applicationAdapter = null, accessService = null }) {
  if (!config.jobSearchEnabled) return null;
  const jobsAccessService = accessService || configuredOwnerJobAccess(pool, config.operationsOwnerTelegramId);
  let connectionService = null, connectionSessionService = null, loginLinkDelivery = null, browserClient = null;
  if (config.jobBrowserOwnerId && config.jobBrowserToken) {
    browserClient = new JobBrowserClient({ baseUrl: config.jobBrowserUrl, ownerId: config.jobBrowserOwnerId,
      token: config.jobBrowserToken, connectToken: config.jobBrowserConnectToken || null, resumeToken:config.jobBrowserResumeToken||null, fetchImpl });
    connectionService = new JobBrowserConnectionService({ pool, browserClient, accessService: jobsAccessService });
    if (config.jobBrowserConnectToken && accessService) {
      connectionSessionService = new JobConnectionSessionService({
        repository: new JobConnectionSessionRepository(pool), accessService, browserClient,
      });
      if (config.miniAppEnabled && config.miniAppPublicOrigin && send)
        loginLinkDelivery = new JobLoginLinkDelivery({ sessions: connectionSessionService,
          repository: connectionSessionService.repository, origin: config.miniAppPublicOrigin, send });
    }
  }
  if (!applicationAdapter && config.jobBrowserApplyEnabled === true) {
    applicationAdapter = new JobBrowserClient({ baseUrl: config.jobBrowserUrl, ownerId: config.jobBrowserOwnerId,
      token: config.jobBrowserToken, applyToken: config.jobBrowserApplyToken, fetchImpl }).asApplicationAdapter();
  }
  const defaults = {};
  const resumeRepository=browserClient?new JobResumeRepository(pool,jobsAccessService):null;
  const resumeService=resumeRepository?new JobResumeService({repository:resumeRepository,browserClient}):null;
  const resumeWorker=resumeService?new JobResumeWorker({service:resumeService,repository:resumeRepository,browserClient}):null;
  for (const [key, value] of Object.entries({ budgetUsd: config.jobBudgetUsd,
    intervalMs: config.jobCollectorIntervalMs, historyDays: config.jobHistoryDays })) if (value !== undefined) defaults[key] = value;
  const searchRepository = new JobSearchRepository(pool, { defaults, accessService: jobsAccessService });
  const profileRepository = new JobProfileRepository(pool, { accessService: jobsAccessService });
  const draftRepository = new JobDraftRepository(pool, { accessService: jobsAccessService });
  const resumeContextService = new JobResumeContextService({ pool, browserClient, accessService: jobsAccessService });
  const usageRepository = new JobUsageRepository(pool);
  const deliveryRepository = new JobDeliveryRepository(pool, { accessService: jobsAccessService });
  const modelAdapter = new JobModelAdapter({ config, fetchImpl });
  const automationRepository = new JobAutomationRepository(pool, { accessService: jobsAccessService });
  const automationService = new JobAutomationService({ pool, repository: automationRepository, searchRepository,
    resumeContextService, accessService: jobsAccessService,
    available: Boolean(modelAdapter.available && browserClient && applicationAdapter?.capabilities?.applicantApply) });
  const draftService = new JobDraftService({ pool, searchRepository, profileRepository, draftRepository, usageRepository,
    modelAdapter, accessService: jobsAccessService, resumeContextService });
  const settingsService = new JobSettingsService({ pool, searchRepository, profileRepository, accessService: jobsAccessService });
  const applicationRepository = new JobApplicationRepository(pool, { accessService: jobsAccessService });
  const historyRepository=new JobHistoryRepository(pool,{accessService: jobsAccessService});
  const historySync=new JobHistorySyncRepository(pool,historyRepository,{accessService: jobsAccessService});
  const historyWorker=browserClient?new JobHistoryWorker({repository:historySync,client:browserClient}):null;
  const historyService=new JobHistoryTelegram({repository:historyRepository,syncRepository:historySync,available:Boolean(browserClient)});
  const applicationService = new JobApplicationService({ pool, repository: applicationRepository, searchRepository,
    adapter: applicationAdapter, historyRepository, accessService: jobsAccessService, automationRepository });
  const automationWorker = new JobAutomationWorker({ pool, repository: automationRepository, automationService,
    searchRepository, profileRepository, resumeContextService, modelAdapter, draftService, applicationService,
    usageRepository, accessService: jobsAccessService });
  if (config.jobCaptchaTelegram && !config.jobCaptchaToken) throw new Error('JOB_CAPTCHA_CONFIG_INVALID');
  let captchaService = null, captchaWorker = null;
  if (config.jobCaptchaTelegram && config.jobCaptchaToken) {
    const client = new JobCaptchaClient({ ownerId: config.jobBrowserOwnerId, token: config.jobCaptchaToken, fetchImpl });
    const repository = new JobCaptchaRepository(pool, { accessService: jobsAccessService });
    captchaService = new JobCaptchaService({ repository, client });
    captchaWorker = new JobCaptchaWorker({ repository, client, sendPhoto,
      automatic: config.jobCaptchaAutomatic === true });
  }
  const telegramService = new JobTelegramService({ pool, searchRepository, profileRepository, draftRepository,
    usageRepository, interactions, draftService, settingsService, applicationService, connectionService, captchaService, historyService, resumeService,
    accessService: jobsAccessService, ownerTelegramId: config.operationsOwnerTelegramId, loginLinkDelivery, automationService,
    jobPublicOrigin: config.miniAppEnabled ? config.miniAppPublicOrigin : '' });
  const deliveryWorker = new JobDeliveryWorker({ pool, searchRepository, deliveryRepository, send, accessService: jobsAccessService,
    captchaEnabled: Boolean(captchaService), captchaAutomatic: config.jobCaptchaAutomatic === true, automationService });
  const recoveryWorker = new JobRecoveryWorker({ pool, applicationRepository });
  const close = createResourceCloser(Object.entries({ deliveryWorker, recoveryWorker, captchaWorker, historyWorker, connectionSessionService, resumeWorker, automationWorker })
    .filter(([, worker]) => worker).map(([name, worker]) => ({ name, close: () => worker.stop() })));
  return { captchaService, telegramService, deliveryWorker, applicationService, applicationRepository, historyWorker, historyRepository, historySync,
    connectionSessionService, loginLinkDelivery, resumeService, resumeWorker, automationService, automationWorker,
    async start() { await recoveryWorker.start(); connectionSessionService?.start(); deliveryWorker.start(); captchaWorker?.start(); historyWorker?.start(); await resumeWorker?.start(); if (automationService.available) automationWorker.start(); },
    close };
}
module.exports = { createJobRuntime };
