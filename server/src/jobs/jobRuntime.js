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

function createJobRuntime({ config, pool, interactions, send, fetchImpl }) {
  if (!config.jobSearchEnabled) return null;
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
  const telegramService = new JobTelegramService({ pool, searchRepository, profileRepository, draftRepository,
    usageRepository, interactions, draftService, settingsService, defaultModel: config.jobSearchModel });
  const deliveryWorker = new JobDeliveryWorker({ pool, searchRepository, deliveryRepository, send });
  return { telegramService, deliveryWorker, start() { deliveryWorker.start(); }, close() { return deliveryWorker.close(); } };
}
module.exports = { createJobRuntime };
