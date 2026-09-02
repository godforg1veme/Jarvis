const { buildApp } = require('./app');
const { AssistantService } = require('./assistant/assistantService');
const { createPool, databaseReadinessCheck } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { createAnswerProvider } = require('./providers/providerFactory');
const { providerProfileForConfig } = require('./providers/providerProfile');
const { createTelegramAccessPolicy } = require('./telegram/accessPolicy');
const { createTelegramBot } = require('./telegram/bot');
const { TelegramMessageService } = require('./telegram/messageService');
const { TelegramUpdateRepository } = require('./telegram/telegramUpdateRepository');
const { UserRepository } = require('./users/userRepository');
const { ConversationRepository } = require('./conversations/conversationRepository');
const { DeviceRepository } = require('./devices/deviceRepository');
const { createDeviceAuthenticator } = require('./devices/deviceAuth');
const { DeviceService } = require('./devices/deviceService');
const { registerDeviceSessionRoute } = require('./devices/deviceSessionRoute');
const { createAsrProvider } = require('./asr/asrProvider');
const { DesktopRequestRepository } = require('./desktop/desktopRequestRepository');
const { DesktopMessageService } = require('./desktop/desktopMessageService');
const { registerDesktopRoutes } = require('./desktop/desktopRoutes');
const { FixedWindowRateLimiter } = require('./http/rateLimiter');
const { MemoryRepository } = require('./memory/memoryRepository');
const { MemoryService } = require('./memory/memoryService');
const { DocumentStorage } = require('./knowledge/documentStorage');
const { DocumentRepository } = require('./knowledge/documentRepository');
const { KnowledgeService, KnowledgeWorker } = require('./knowledge/knowledgeService');
const { SystemDocumentExtractor } = require('./knowledge/systemDocumentExtractor');

async function createRuntime(config, overrides = {}) {
  let pool = overrides.pool || null;
  if (!pool && config.databaseUrl) pool = createPool(config);

  const readinessChecks = pool ? [databaseReadinessCheck(pool)] : [];
  const app = overrides.app || buildApp({ config, readinessChecks });
  let bot = overrides.bot || null;

  if (pool) {
    await (overrides.runMigrations || runMigrations)(pool);
  }

  let assistant = overrides.assistant || null;
  let deviceService = null;
  let memoryService = null;
  let knowledgeService = null;
  let knowledgeWorker = null;
  if (pool) {
    const answerProvider = overrides.provider || createAnswerProvider(config, {
      onFallback(name, error) {
        app.log.warn({ provider: name, err: error }, 'model provider fallback');
      },
    });
    assistant = assistant || new AssistantService({
      provider: answerProvider,
      profile: providerProfileForConfig(config),
      logger: app.log,
    });
    const deviceRepository = overrides.deviceRepository || new DeviceRepository(pool);
    const authenticateDevice = overrides.authenticateDevice || createDeviceAuthenticator(deviceRepository);
    deviceService = overrides.deviceService || new DeviceService({ repository: deviceRepository });
    memoryService = overrides.memoryService || new MemoryService({ repository: overrides.memoryRepository || new MemoryRepository(pool) });
    if (typeof pool.query === 'function') {
      const knowledgeRepository = overrides.knowledgeRepository || new DocumentRepository(pool);
      const documentExtractor = overrides.documentExtractor || new SystemDocumentExtractor({
        pdfToTextBin: config.pdfToTextBin,
        ffprobeBin: config.ffprobeBin,
      });
      knowledgeService = overrides.knowledgeService || new KnowledgeService({
        repository: knowledgeRepository,
        storage: overrides.documentStorage || new DocumentStorage({ root: config.documentStoragePath }),
        maxBytes: config.documentMaxBytes,
        userQuotaBytes: config.documentUserQuotaBytes,
        extract: typeof documentExtractor === 'function'
          ? documentExtractor
          : documentExtractor.extract.bind(documentExtractor),
      });
      knowledgeWorker = overrides.knowledgeWorker || new KnowledgeWorker({
        repository: knowledgeRepository,
        service: knowledgeService,
        intervalMs: config.documentWorkerIntervalMs,
        logger: app.log,
      });
    }
    const desktopMessageService = overrides.desktopMessageService || new DesktopMessageService({
      requestRepository: overrides.desktopRequestRepository || new DesktopRequestRepository(pool),
      conversationRepository: overrides.conversationRepository || new ConversationRepository(pool),
      assistant,
      memoryService,
      knowledgeService,
      deviceService,
    });
    if (typeof app.post === 'function' && typeof app.addContentTypeParser === 'function') {
      registerDesktopRoutes(app, {
        authenticate: authenticateDevice,
        deviceService,
        messageService: desktopMessageService,
        asr: overrides.asr || createAsrProvider(config),
        limiter: overrides.desktopRateLimiter || new FixedWindowRateLimiter(),
      });
    }
    if (typeof app.register === 'function' && typeof app.get === 'function') {
      await registerDeviceSessionRoute(app, {
        authenticate: authenticateDevice,
        repository: deviceRepository,
        logger: app.log,
      });
    }

    if (!bot && config.telegramBotToken) {
    const messageService = new TelegramMessageService({
      accessPolicy: createTelegramAccessPolicy(config.telegramAllowedIds),
      updateRepository: new TelegramUpdateRepository(pool),
      userRepository: new UserRepository(pool),
      conversationRepository: new ConversationRepository(pool),
      assistant,
      deviceService,
      memoryService,
      knowledgeService,
    });
    bot = createTelegramBot({
      token: config.telegramBotToken,
      messageService,
      logger: app.log,
      documentMaxBytes: config.documentMaxBytes,
    });
    }
  }

  return {
    app,
    bot,
    pool,
    assistant,
    deviceService,
    memoryService,
    knowledgeService,
    async start() {
      await app.listen({ host: config.host, port: config.port });
      if (knowledgeWorker) knowledgeWorker.start();
      if (bot) void bot.start().catch((error) => app.log.error({ err: error }, 'Telegram polling stopped'));
    },
    async close() {
      if (knowledgeWorker) knowledgeWorker.stop();
      if (bot && (typeof bot.isRunning !== 'function' || bot.isRunning())) await bot.stop();
      await app.close();
      if (pool) await pool.end();
    },
  };
}

module.exports = { createRuntime };
