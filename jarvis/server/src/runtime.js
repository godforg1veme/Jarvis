const { buildApp } = require('./app');
const { AssistantService } = require('./assistant/assistantService');
const { createPool, databaseReadinessCheck } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { createAnswerProvider } = require('./providers/providerFactory');
const { providerProfileForConfig } = require('./providers/providerProfile');
const { createTelegramAccessPolicy } = require('./telegram/accessPolicy');
const { createTelegramBot } = require('./telegram/bot');
const { sendTelegramText } = require('./telegram/telegramFormatting');
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
const { createEmbeddingProvider } = require('./knowledge/embeddingProvider');
const { CommandRepository } = require('./commands/commandRepository');
const { CommandService } = require('./commands/commandService');
const { registerCommandRoutes } = require('./commands/commandRoutes');
const { DeviceSessionRegistry } = require('./commands/deviceSessionRegistry');
const { CommandWorker } = require('./commands/commandWorker');
const { createActionManifest } = require('./orchestrator/actionManifest');
const { ActionOrchestrator } = require('./orchestrator/actionOrchestrator');
const { CommandResultBroker } = require('./orchestrator/commandResultBroker');
const { DesktopCommandExecutor, ExecutorRegistry } = require('./orchestrator/executorRegistry');
const { ToolIntentPlanner } = require('./orchestrator/toolIntentPlanner');
const { WorkflowRepository } = require('./orchestrator/workflowRepository');
const { createRemoteMessage } = require('./devices/remoteProtocol');
const { createOperationsRuntime } = require('./operations/operationsRuntime');
const { VisionLeaseStore } = require('./vision/visionLeaseStore');
const { createVisionProvider } = require('./vision/visionProviderFactory');
const { registerVisionRoutes } = require('./vision/visionRoutes');
const { VisualMemoryStorage } = require('./vision/visualMemoryStorage');
const { VisualMemoryRepository } = require('./vision/visualMemoryRepository');
const { VisualMemoryService, VisualMemoryWorker } = require('./vision/visualMemoryService');
const { SceneStateStore } = require('./vision/sceneState');

async function createRuntime(config, overrides = {}) {
  let pool = overrides.pool || null;
  if (!pool && config.databaseUrl) pool = createPool(config);

  const readinessChecks = pool ? [databaseReadinessCheck(pool)] : [];
  const app = overrides.app || buildApp({ config, readinessChecks });
  let bot = overrides.bot || null;
  let pollingHealth = { at: 0, ok: false };

  if (pool) {
    await (overrides.runMigrations || runMigrations)(pool);
  }

  let assistant = overrides.assistant || null;
  let deviceService = null;
  let memoryService = null;
  let knowledgeService = null;
  let knowledgeWorker = null;
  let commandService = null;
  let commandWorker = null;
  let orchestrator = null;
  let operationsRuntime = null;
  let visualMemoryService = null;
  let visualMemoryWorker = null;
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
    const conversationRepository = overrides.conversationRepository || new ConversationRepository(pool);
    const authenticateDevice = overrides.authenticateDevice || createDeviceAuthenticator(deviceRepository);
    deviceService = overrides.deviceService || new DeviceService({ repository: deviceRepository });
    const sessionRegistry = overrides.sessionRegistry || new DeviceSessionRegistry();
    const commandRepository = overrides.commandRepository || new CommandRepository(pool);
    const resultBroker = overrides.resultBroker || new CommandResultBroker({ logger: app.log });
    commandService = overrides.commandService || new CommandService({
      repository: commandRepository,
      deviceRepository,
      sessionRegistry,
      resultBroker,
    });
    const actionManifest = overrides.actionManifest || createActionManifest();
    const executorRegistry = overrides.executorRegistry || new ExecutorRegistry()
      .register('device', new DesktopCommandExecutor({ commandService }));
    orchestrator = overrides.orchestrator || new ActionOrchestrator({
      repository: overrides.workflowRepository || new WorkflowRepository(pool),
      planner: overrides.toolIntentPlanner || new ToolIntentPlanner({
        provider: answerProvider,
        manifest: actionManifest,
        logger: app.log,
      }),
      manifest: actionManifest,
      executors: executorRegistry,
      commandService,
      deviceRepository,
      conversationRepository,
      deliverUpdate: async ({ workflow, answer, response }) => {
        if (workflow.origin_channel === 'desktop' && workflow.origin_device_id) {
          sessionRegistry.send(workflow.origin_device_id, createRemoteMessage('workflow.update', {
            workflowId: workflow.id,
            status: response?.pending ? 'awaiting_result' : 'completed',
            answer,
          }));
          return;
        }
        const chatId = workflow.state && workflow.state.originChatId;
        if (workflow.origin_channel === 'telegram' && chatId && bot && bot.api) {
          await sendTelegramText(
            (chunk, options) => bot.api.sendMessage(chatId, chunk, options),
            answer,
          );
        }
      },
    });
    if (resultBroker && typeof resultBroker.subscribe === 'function') {
      resultBroker.subscribe((command) => orchestrator.onCommandTerminal(command));
    }
    commandWorker = overrides.commandWorker || new CommandWorker({
      repository: commandRepository,
      logger: app.log,
    });
    memoryService = overrides.memoryService || new MemoryService({ repository: overrides.memoryRepository || new MemoryRepository(pool) });
    if (typeof pool.query === 'function') {
      const knowledgeRepository = overrides.knowledgeRepository || new DocumentRepository(pool);
      const documentExtractor = overrides.documentExtractor || new SystemDocumentExtractor({
        pdfToTextBin: config.pdfToTextBin,
        ffprobeBin: config.ffprobeBin,
      });
      const embeddingProvider = overrides.embeddingProvider || createEmbeddingProvider(config, {
        fetchImpl: overrides.embeddingFetch,
      });
      knowledgeService = overrides.knowledgeService || new KnowledgeService({
        repository: knowledgeRepository,
        storage: overrides.documentStorage || new DocumentStorage({ root: config.documentStoragePath }),
        maxBytes: config.documentMaxBytes,
        userQuotaBytes: config.documentUserQuotaBytes,
        extract: typeof documentExtractor === 'function'
          ? documentExtractor
          : documentExtractor.extract.bind(documentExtractor),
        embeddingProvider,
      });
      knowledgeWorker = overrides.knowledgeWorker || new KnowledgeWorker({
        repository: knowledgeRepository,
        service: knowledgeService,
        intervalMs: config.documentWorkerIntervalMs,
        logger: app.log,
      });
    }
    visualMemoryService = overrides.visualMemoryService || (!config.visionProvider || config.visionProvider === 'disabled' ? null : new VisualMemoryService({
      repository: new VisualMemoryRepository(pool),
      storage: new VisualMemoryStorage({ root: config.visionMemoryPath, key: config.visionMemoryKey }),
      quotaBytes: config.visionUserQuotaBytes,
      logger: app.log,
    }));
    if (visualMemoryService) visualMemoryWorker = overrides.visualMemoryWorker || new VisualMemoryWorker({ service: visualMemoryService, logger: app.log });
    const desktopMessageService = overrides.desktopMessageService || new DesktopMessageService({
      requestRepository: overrides.desktopRequestRepository || new DesktopRequestRepository(pool),
      conversationRepository,
      assistant,
      memoryService,
      knowledgeService,
      deviceService,
      commandService,
      orchestrator,
      visualMemoryService,
    });
    if (typeof app.post === 'function' && typeof app.addContentTypeParser === 'function') {
      const desktopRateLimiter = overrides.desktopRateLimiter || new FixedWindowRateLimiter();
      registerDesktopRoutes(app, {
        authenticate: authenticateDevice,
        deviceService,
        messageService: desktopMessageService,
        asr: overrides.asr || createAsrProvider(config),
        limiter: desktopRateLimiter,
      });
      registerCommandRoutes(app, {
        authenticate: authenticateDevice,
        commandService,
        limiter: desktopRateLimiter,
      });
      registerVisionRoutes(app, {
        authenticate: authenticateDevice,
        leaseStore: overrides.visionLeaseStore || new VisionLeaseStore(),
        provider: overrides.visionProvider || createVisionProvider(config, {
          fetchImpl: overrides.visionFetch,
          fake: overrides.fakeVisionProvider,
        }),
        limiter: overrides.visionRateLimiter || desktopRateLimiter,
        memoryService: visualMemoryService,
        sceneStore: overrides.visionSceneStore || new SceneStateStore(),
      });
    }
    if (typeof app.register === 'function' && typeof app.get === 'function') {
      await registerDeviceSessionRoute(app, {
        authenticate: authenticateDevice,
        repository: deviceRepository,
        sessionRegistry,
        commandService,
        logger: app.log,
      });
    }

    if (!bot && config.telegramBotToken) {
    const messageService = new TelegramMessageService({
      accessPolicy: createTelegramAccessPolicy(config.telegramAllowedIds),
      updateRepository: new TelegramUpdateRepository(pool),
      userRepository: new UserRepository(pool),
      conversationRepository,
      assistant,
      deviceService,
      memoryService,
      knowledgeService,
      commandService,
      orchestrator,
      visualMemoryService,
    });
    bot = createTelegramBot({
      token: config.telegramBotToken,
      messageService,
      logger: app.log,
      documentMaxBytes: config.documentMaxBytes,
      onPollingHealth: (value) => { pollingHealth = value; },
    });
    }
    operationsRuntime = await (overrides.createOperationsRuntime || createOperationsRuntime)({
      config,
      pool,
      app,
      getBot: () => bot,
      getPollingHealth: () => pollingHealth,
      onDeviceRevoked: (id) => {
        const session = sessionRegistry.get(id);
        if (session) {
          sessionRegistry.unregister(id, session.socket);
          try { session.socket.close(1008, 'device reassigned'); } catch (_) {}
        }
      },
      logger: app.log,
      overrides: overrides.operations || {},
    });
    if (operationsRuntime.enabled && bot && typeof bot.on === 'function') {
      bot.on('callback_query:data', operationsRuntime.approvalHandler);
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
    orchestrator,
    operationsRuntime,
    async start() {
      await app.listen({ host: config.host, port: config.port });
      if (operationsRuntime) await operationsRuntime.start();
      if (knowledgeWorker) knowledgeWorker.start();
      if (visualMemoryWorker) visualMemoryWorker.start();
      if (commandWorker) commandWorker.start();
      if (bot) void bot.start().catch((error) => app.log.error({ err: error }, 'Telegram polling stopped'));
    },
    async close() {
      if (knowledgeWorker) knowledgeWorker.stop();
      if (visualMemoryWorker) visualMemoryWorker.stop();
      if (commandWorker) commandWorker.stop();
      if (operationsRuntime) await operationsRuntime.close();
      if (bot && (typeof bot.isRunning !== 'function' || bot.isRunning())) await bot.stop();
      await app.close();
      if (pool) await pool.end();
    },
  };
}

module.exports = { createRuntime };
