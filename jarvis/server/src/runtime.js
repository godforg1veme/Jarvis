const { buildApp } = require('./app');
const { AssistantService } = require('./assistant/assistantService');
const { createPool, databaseReadinessCheck } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { createAnswerProvider } = require('./providers/providerFactory');
const { providerProfileForConfig } = require('./providers/providerProfile');
const { createTelegramAccessPolicy } = require('./telegram/accessPolicy');
const { createTelegramBot } = require('./telegram/bot');
const { sendTelegramText } = require('./telegram/telegramFormatting');
const { MAX_TELEGRAM_VOICE_BYTES, TelegramMessageService } = require('./telegram/messageService');
const { TelegramUpdateRepository } = require('./telegram/telegramUpdateRepository');
const { TelegramInteractionRepository } = require('./telegram/telegramInteractionRepository');
const { TelegramMenuService } = require('./telegram/telegramMenuService');
const { TelegramMemoryGalleryRepository } = require('./telegram/telegramMemoryGalleryRepository');
const { TelegramMemoryGalleryService } = require('./telegram/telegramMemoryGalleryService');
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
const { DesktopCommandExecutor, ExecutorRegistry, ServerActionExecutor } = require('./orchestrator/executorRegistry');
const { ToolIntentPlanner } = require('./orchestrator/toolIntentPlanner');
const { WorkflowRepository } = require('./orchestrator/workflowRepository');
const { createRemoteMessage } = require('./devices/remoteProtocol');
const { createOperationsRuntime } = require('./operations/operationsRuntime');
const { HostAgentClient } = require('./operations/hostAgentClient');
const { VpnRepository } = require('./vpn/vpnRepository');
const { VpnCommandService } = require('./vpn/vpnCommandService');
const { VpnRecoveryWorker } = require('./vpn/vpnRecoveryWorker');
const { VisionLeaseStore } = require('./vision/visionLeaseStore');
const { createVisionProvider } = require('./vision/visionProviderFactory');
const { registerVisionRoutes } = require('./vision/visionRoutes');
const { VisualMemoryStorage } = require('./vision/visualMemoryStorage');
const { VisualMemoryRepository } = require('./vision/visualMemoryRepository');
const { VisualMemoryService, VisualMemoryWorker } = require('./vision/visualMemoryService');
const { SceneStateStore } = require('./vision/sceneState');
const { LifeEventRepository } = require('./life/lifeEventRepository');
const { LifeEventGateway } = require('./life/lifeEventGateway');
const { LifeProjectionRepository } = require('./life/lifeProjectionRepository');
const { LifeProjectionWorker } = require('./life/lifeProjectionWorker');
const { CommitmentDetector } = require('./life/commitmentDetector');
const { LifeLinker } = require('./life/lifeLinker');
const { LifeEnrichmentService } = require('./life/lifeEnrichmentService');
const { LifeProjectService } = require('./life/lifeProjectService');
const { TimelineService } = require('./life/timelineService');
const { ContextRecoveryService } = require('./life/contextRecoveryService');
const { MissionControlService } = require('./life/missionControlService');
const { ProposalService } = require('./life/proposalService');
const { ProactivityWorker } = require('./life/proactivityWorker');
const { ProactivityRepository } = require('./life/proactivity/proactivityRepository');
const { registerLifeRoutes } = require('./life/lifeRoutes');
const { LifeContextComposer } = require('./life/context/lifeContextComposer');
const { LifeModeRepository } = require('./life/modes/lifeModeRepository');
const { LifeModeService } = require('./life/modes/lifeModeService');
const { LifePreferenceRepository } = require('./life/preferences/lifePreferenceRepository');
const { LifePreferenceService } = require('./life/preferences/lifePreferenceService');
const { FeedbackAggregator } = require('./life/preferences/feedbackAggregator');
const { PriorityRepository } = require('./life/priority/priorityRepository');
const { PriorityEngine } = require('./life/priority/priorityEngine');
const { ReminderRepository } = require('./life/reminders/reminderRepository');
const { ReminderService } = require('./life/reminders/reminderService');
const { ReminderWorker } = require('./life/reminders/reminderWorker');
const { ReminderDeliveryRouter } = require('./life/reminders/reminderDeliveryRouter');
const { DesktopReminderTransport, TelegramReminderTransport } = require('./life/reminders/reminderTransports');
const { RecoveryPlanRepository } = require('./life/recovery/recoveryPlanRepository');
const { RecoveryPlanService } = require('./life/recovery/recoveryPlanService');
const { SourceConnectionRepository } = require('./life/sources/sourceConnectionRepository');
const { CommitmentRepository } = require('./life/commitments/commitmentRepository');
const { CommitmentLifecycleService } = require('./life/commitments/commitmentLifecycleService');
const { PeopleRepository } = require('./life/people/peopleRepository');
const { PeopleService } = require('./life/people/peopleService');
const { PersonLinker } = require('./life/people/personLinker');
const { FamilyAccessService } = require('./life/people/familyAccessService');

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
  let asr = null;
  let vpnService = null;
  let vpnRecoveryWorker = null;
  let lifeEventGateway = null;
  let lifeProjectionWorker = null;
  let proactivityWorker = null;
  let reminderWorker = null;
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
    let lifeEventRepository = null;
    let lifeProjectionRepository = null;
    let lifeModeRepository = null;
    let lifePreferenceRepository = null;
    let lifePriorityRepository = null;
    let lifeModeService = null;
    let lifePreferenceService = null;
    let lifeFeedbackAggregator = null;
    let lifePeopleRepository = null;
    let lifePeopleService = null;
    let lifeFamilyAccessService = null;
    let lifePriorityEngine = null;
    let lifeReminderRepository = null;
    let lifeReminderService = null;
    let lifeRecoveryRepository = null;
    let lifeSourceRepository = null;
    let lifeCommitmentRepository = null;
    let lifeCommitmentLifecycleService = null;
    if (config.lifeOsEnabled) {
      lifeEventRepository = overrides.lifeEventRepository || new LifeEventRepository(pool);
      lifeProjectionRepository = overrides.lifeProjectionRepository || new LifeProjectionRepository(pool);
      lifeModeRepository = overrides.lifeModeRepository || new LifeModeRepository(pool);
      lifePreferenceRepository = overrides.lifePreferenceRepository || new LifePreferenceRepository(pool);
      lifePriorityRepository = overrides.lifePriorityRepository || new PriorityRepository(pool);
      lifePeopleRepository = overrides.lifePeopleRepository || new PeopleRepository(pool);
      lifeReminderRepository = overrides.lifeReminderRepository || new ReminderRepository(pool);
      lifeRecoveryRepository = overrides.lifeRecoveryRepository || new RecoveryPlanRepository(pool);
      lifeSourceRepository = overrides.lifeSourceRepository || new SourceConnectionRepository(pool);
      lifeCommitmentRepository = overrides.lifeCommitmentRepository || new CommitmentRepository(pool);
      lifePriorityEngine = overrides.lifePriorityEngine || new PriorityEngine({ repository: lifePriorityRepository });
      lifeEventGateway = overrides.lifeEventGateway || new LifeEventGateway({
        repository: lifeEventRepository,
        enabled: true,
        logger: app.log,
      });
      lifeModeService = overrides.lifeModeService || new LifeModeService({
        repository: lifeModeRepository, gateway: lifeEventGateway,
      });
      lifePreferenceService = overrides.lifePreferenceService || new LifePreferenceService({
        repository: lifePreferenceRepository, gateway: lifeEventGateway,
      });
      lifeFeedbackAggregator = overrides.lifeFeedbackAggregator || new FeedbackAggregator({
        repository: lifePreferenceRepository,
      });
      lifePeopleService = overrides.lifePeopleService || new PeopleService({
        repository: lifePeopleRepository, gateway: lifeEventGateway,
      });
      lifeFamilyAccessService = overrides.lifeFamilyAccessService || new FamilyAccessService({
        repository: lifePeopleRepository, gateway: lifeEventGateway,
      });
      lifeCommitmentLifecycleService = overrides.lifeCommitmentLifecycleService || new CommitmentLifecycleService({
        repository: lifeCommitmentRepository, gateway: lifeEventGateway,
      });
      lifeReminderService = overrides.lifeReminderService || new ReminderService({
        repository: lifeReminderRepository, gateway: lifeEventGateway,
      });
    }
    const commandRepository = overrides.commandRepository || new CommandRepository(pool);
    const resultBroker = overrides.resultBroker || new CommandResultBroker({ logger: app.log });
    commandService = overrides.commandService || new CommandService({
      repository: commandRepository,
      deviceRepository,
      sessionRegistry,
      resultBroker,
    });
    const actionManifest = overrides.actionManifest || createActionManifest();
    const workflowRepository = overrides.workflowRepository || new WorkflowRepository(pool);
    const executorRegistry = overrides.executorRegistry || new ExecutorRegistry()
      .register('device', new DesktopCommandExecutor({ commandService }));
    if (!overrides.executorRegistry && config.lifeOsEnabled) executorRegistry.register('server', new ServerActionExecutor({
      reminderService: lifeReminderService,
      commitmentRepository: lifeCommitmentRepository,
      projectionRepository: lifeProjectionRepository,
      deviceRepository,
      workflowRepository,
    }));
    orchestrator = overrides.orchestrator || new ActionOrchestrator({
      repository: workflowRepository,
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
      lifeEventGateway,
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
    let proposalService = null;
    let projectService = null;
    let timelineService = null;
    let contextRecoveryService = null;
    let missionControlService = null;
    let recoveryPlanService = null;
    if (config.lifeOsEnabled) {
      proposalService = overrides.proposalService || new ProposalService({
        repository: lifeProjectionRepository, gateway: lifeEventGateway, orchestrator, manifest: actionManifest,
      });
      if (!overrides.orchestrator) orchestrator.onWorkflowStatus = (workflow) => proposalService.onWorkflowStatus(workflow);
      const personLinker = overrides.personLinker || new PersonLinker({
        peopleRepository: lifePeopleRepository,
        projectionRepository: lifeProjectionRepository,
        classify: config.lifeOsEnrichmentEnabled ? overrides.personLinkClassifier : null,
      });
      const linker = overrides.lifeLinker || new LifeLinker({
        repository: lifeProjectionRepository,
        classify: config.lifeOsEnrichmentEnabled ? overrides.lifeLinkClassifier : null,
        personLinker,
      });
      const commitmentDetector = overrides.commitmentDetector || new CommitmentDetector({
        classify: config.lifeOsEnrichmentEnabled ? overrides.commitmentClassifier : null,
      });
      const proactivity = new ProactivityWorker({
        repository: lifeProjectionRepository, eventRepository: lifeEventRepository,
        projectionRepository: lifeProjectionRepository, reminderRepository: lifeReminderRepository,
        commitmentRepository: lifeCommitmentRepository,
        proposalService, manifest: actionManifest,
        proactivityRepository: overrides.proactivityRepository || new ProactivityRepository(pool),
        intervalMs: Math.max(config.lifeOsWorkerIntervalMs * 15, 30000), logger: app.log,
        policyProvider: async ({ userId }) => {
          const [mode, preferences] = await Promise.all([
            lifeModeService.get({ userId }), lifePreferenceService.list({ userId }),
          ]);
          const values = new Map(preferences.map((item) => [item.key, item.value]));
          return {
            proposalVisibility: mode.policy.proposalVisibility,
            suppressedRules: values.get('proposal.suppressed_rules') || [],
            maxPerDay: values.get('notifications.max_proactive_per_day') ?? 10,
          };
        },
        deliverProposal: async (proposal) => {
          if (proposal.origin_channel === 'desktop' && proposal.origin_device_id) {
            sessionRegistry.send(proposal.origin_device_id, createRemoteMessage('life.proposal', {
              proposalId: proposal.id, title: proposal.title,
              explanation: proposal.explanation, risk: proposal.risk_class,
            }));
            return;
          }
          if (proposal.origin_channel === 'telegram' && proposal.origin_conversation_id && bot?.api) {
            const conversation = await conversationRepository.getForUser({
              userId: proposal.user_id, conversationId: proposal.origin_conversation_id,
            });
            if (conversation?.channel === 'telegram') await sendTelegramText(
              (chunk, options) => bot.api.sendMessage(conversation.external_chat_id, chunk, options),
              `Life OS предлагает: ${proposal.title}\n${proposal.explanation}`,
              { reply_markup: { inline_keyboard: [[
                { text: '✅ Принять', callback_data: `life:confirm:${proposal.id}` },
                { text: 'Не сейчас', callback_data: `life:dismiss:${proposal.id}` },
              ]] } },
            );
          }
        },
      });
      const enrichment = new LifeEnrichmentService({
        linker, commitmentDetector, repository: lifeProjectionRepository,
        commitmentRepository: lifeCommitmentRepository,
        commitmentLifecycleService: lifeCommitmentLifecycleService,
        gateway: lifeEventGateway,
      });
      lifeProjectionWorker = overrides.lifeProjectionWorker || new LifeProjectionWorker({
        eventRepository: lifeEventRepository, projectionRepository: lifeProjectionRepository,
        enrich: async (event) => {
          const result = overrides.lifeEventEnricher
            ? await overrides.lifeEventEnricher(event, enrichment)
            : await enrichment.enrich(event);
          if (config.lifeOsProactivityEnabled) await proactivity.evaluateEvent(event, result && result.linked);
          return result;
        },
        intervalMs: config.lifeOsWorkerIntervalMs, logger: app.log,
      });
      proactivityWorker = overrides.proactivityWorker || proactivity;
      projectService = new LifeProjectService({ repository: lifeProjectionRepository, gateway: lifeEventGateway });
      timelineService = new TimelineService({ repository: lifeProjectionRepository });
      contextRecoveryService = new ContextRecoveryService({ repository: lifeProjectionRepository, deviceRepository });
      recoveryPlanService = overrides.recoveryPlanService || new RecoveryPlanService({
        repository: lifeRecoveryRepository, contextService: contextRecoveryService,
        conversationRepository, proposalService, gateway: lifeEventGateway,
      });
      contextRecoveryService.recoveryPlanService = recoveryPlanService;
      proposalService.recoveryPlanService = recoveryPlanService;
      missionControlService = overrides.missionControlService || new MissionControlService({
        repository: lifeProjectionRepository, deviceRepository,
        priorityRepository: lifePriorityRepository, priorityEngine: lifePriorityEngine,
        modeService: lifeModeService, preferenceRepository: lifePreferenceRepository,
        reminderRepository: lifeReminderRepository, recoveryRepository: lifeRecoveryRepository,
        sourceRepository: lifeSourceRepository, gateway: lifeEventGateway,
      });
      const lifeContextComposer = overrides.lifeContextComposer || new LifeContextComposer({
        repository: lifeProjectionRepository,
        priorityRepository: lifePriorityRepository,
        modeRepository: lifeModeRepository,
        modeService: lifeModeService,
        preferenceRepository: lifePreferenceRepository,
        peopleRepository: lifePeopleRepository,
        familyAccessService: lifeFamilyAccessService,
        priorityEngine: lifePriorityEngine,
        deviceRepository,
        enabled: config.lifeOsContextEnabled,
        deadlineMs: config.lifeOsContextDeadlineMs,
      });
      if (assistant && typeof assistant.setLifeContextComposer === 'function') {
        assistant.setLifeContextComposer(lifeContextComposer);
      }
    }
    if (resultBroker && typeof resultBroker.subscribe === 'function') {
      resultBroker.subscribe((command) => orchestrator.onCommandTerminal(command));
    }
    commandWorker = overrides.commandWorker || new CommandWorker({
      repository: commandRepository,
      logger: app.log,
    });
    memoryService = overrides.memoryService || new MemoryService({ repository: overrides.memoryRepository || new MemoryRepository(pool) });
    if (config.operationsEnabled) {
      const vpnRepository = overrides.vpnRepository || new VpnRepository(pool);
      const vpnHostAgentClient = overrides.vpnHostAgentClient || new HostAgentClient({
          socketPath: config.operationsSocketPath,
          authenticatorPath: config.operationsAuthenticatorPath,
        });
      vpnService = overrides.vpnService || new VpnCommandService({
        repository: vpnRepository,
        client: vpnHostAgentClient,
        ownerTelegramId: config.operationsOwnerTelegramId,
      });
      vpnRecoveryWorker = overrides.vpnRecoveryWorker || new VpnRecoveryWorker({
        repository: vpnRepository,
        client: vpnHostAgentClient,
        logger: app.log,
      });
    }
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
        lifeEventGateway,
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
      vpnService,
      lifeEventGateway,
    });
    asr = overrides.asr || createAsrProvider(config);
    if (typeof app.post === 'function' && typeof app.addContentTypeParser === 'function') {
      const desktopRateLimiter = overrides.desktopRateLimiter || new FixedWindowRateLimiter();
      registerDesktopRoutes(app, {
        authenticate: authenticateDevice,
        deviceService,
        messageService: desktopMessageService,
        asr,
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
        lifeEventGateway,
      });
      if (config.lifeOsEnabled) registerLifeRoutes(app, {
        authenticate: authenticateDevice, limiter: desktopRateLimiter,
        repository: lifeProjectionRepository, projectService, timelineService,
        contextService: contextRecoveryService, missionControlService,
        proposalService, gateway: lifeEventGateway, modeService: lifeModeService,
        preferenceService: lifePreferenceService, feedbackAggregator: lifeFeedbackAggregator,
        peopleService: lifePeopleService, familyAccessService: lifeFamilyAccessService,
        reminderService: lifeReminderService, reminderRepository: lifeReminderRepository,
        recoveryPlanService,
      });
    }
    if (typeof app.register === 'function' && typeof app.get === 'function') {
      await registerDeviceSessionRoute(app, {
        authenticate: authenticateDevice,
        repository: deviceRepository,
        sessionRegistry,
        commandService,
        logger: app.log,
        lifeEventGateway,
      });
    }

    if (!bot && config.telegramBotToken) {
      const memoryGalleryService = new TelegramMemoryGalleryService({
        repository: overrides.telegramMemoryGalleryRepository || new TelegramMemoryGalleryRepository(pool),
        knowledgeService,
        visualMemoryService,
      });
      const menuService = new TelegramMenuService({
        interactions: overrides.telegramInteractionRepository || new TelegramInteractionRepository(pool),
        deviceService,
        memoryService,
        knowledgeService,
        vpnService,
        lifeMissionControlService: missionControlService,
        memoryGalleryService,
        ownerTelegramId: config.operationsOwnerTelegramId,
        operationsEnabled: config.operationsEnabled,
        operationsPublicOrigin: config.operationsPublicOrigin,
      });
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
        asr: config.telegramVoiceEnabled ? asr : null,
        voiceLimiter: overrides.telegramVoiceLimiter || new FixedWindowRateLimiter(),
        vpnService,
        lifeEventGateway,
        lifeMissionControlService: missionControlService,
        lifeProposalService: proposalService,
        lifeReminderService,
        menuService,
      });
      bot = createTelegramBot({
        token: config.telegramBotToken,
        messageService,
        logger: app.log,
        documentMaxBytes: config.documentMaxBytes,
        voiceMaxBytes: MAX_TELEGRAM_VOICE_BYTES,
        onPollingHealth: (value) => { pollingHealth = value; },
        operationsPanelUrl: menuService.operationsPanelUrl,
      });
    }
    if (config.lifeOsEnabled && config.lifeOsRemindersEnabled) {
      const reminderRouter = overrides.reminderDeliveryRouter || new ReminderDeliveryRouter({
        telegram: new TelegramReminderTransport({ bot, conversationRepository }),
        desktop: new DesktopReminderTransport({ sessionRegistry }),
      });
      reminderWorker = overrides.reminderWorker || new ReminderWorker({
        repository: lifeReminderRepository, router: reminderRouter, gateway: lifeEventGateway,
        intervalMs: config.lifeOsReminderIntervalMs, batchSize: config.lifeOsReminderBatchSize,
        logger: app.log,
        policyProvider: async ({ userId }) => {
          const [mode, preferences] = await Promise.all([
            lifeModeService.get({ userId }), lifePreferenceService.list({ userId }),
          ]);
          const values = new Map(preferences.map((item) => [item.key, item.value]));
          return {
            notificationPolicy: mode.policy.notificationPolicy,
            deferUntil: mode.expiresAt,
            quietHours: values.get('notifications.quiet_hours'),
            maxPerDay: values.get('notifications.max_proactive_per_day'),
          };
        },
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
    vpnService,
    lifeEventGateway,
    async start() {
      await app.listen({ host: config.host, port: config.port });
      if (operationsRuntime) await operationsRuntime.start();
      if (knowledgeWorker) knowledgeWorker.start();
      if (visualMemoryWorker) visualMemoryWorker.start();
      if (commandWorker) commandWorker.start();
      if (vpnRecoveryWorker) vpnRecoveryWorker.start();
      if (lifeProjectionWorker) lifeProjectionWorker.start();
      if (config.lifeOsProactivityEnabled && proactivityWorker) proactivityWorker.start();
      if (config.lifeOsRemindersEnabled && reminderWorker) reminderWorker.start();
      if (bot) void bot.start().catch((error) => app.log.error({ err: error }, 'Telegram polling stopped'));
    },
    async close() {
      if (knowledgeWorker) knowledgeWorker.stop();
      if (visualMemoryWorker) visualMemoryWorker.stop();
      if (commandWorker) commandWorker.stop();
      if (vpnRecoveryWorker) vpnRecoveryWorker.stop();
      if (lifeProjectionWorker) lifeProjectionWorker.stop();
      if (proactivityWorker) proactivityWorker.stop();
      if (reminderWorker) reminderWorker.stop();
      if (operationsRuntime) await operationsRuntime.close();
      if (bot && (typeof bot.isRunning !== 'function' || bot.isRunning())) await bot.stop();
      await app.close();
      if (pool) await pool.end();
    },
  };
}

module.exports = { createRuntime };
