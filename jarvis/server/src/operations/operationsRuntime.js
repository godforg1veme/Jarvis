const { HostAgentClient } = require('./hostAgentClient');
const { CollectorWorker } = require('./collectors/collectorWorker');
const { OperationsRepository } = require('./repositories/operationsRepository');
const { PanelSessionRepository } = require('./repositories/panelSessionRepository');
const { ConnectionAdminRepository } = require('./repositories/connectionAdminRepository');
const { ConnectionAdminService } = require('./connections/connectionAdminService');
const { SessionService } = require('./sessions/sessionService');
const { createTelegramApprovalHandler } = require('./sessions/telegramApproval');
const { registerSessionRoutes } = require('./routes/sessionRoutes');
const { requireOperationsHost, requirePanelSession, requireSameOrigin } = require('./auth/requirePanelSession');
const { registerReadRoutes } = require('./routes/readRoutes');
const { registerConnectionRoutes } = require('./routes/connectionRoutes');
const { registerOperationsStatic } = require('./operationsStatic');
const { SseHub } = require('./sseHub');
const { IncidentEngine } = require('./incidents/incidentEngine');
const { IncidentNotifier } = require('./incidents/incidentNotifier');
const { RollupWorker } = require('./collectors/rollupWorker');
const { RetentionWorker } = require('./collectors/retentionWorker');
const { OperationRepository } = require('./repositories/operationRepository');
const { OperationService } = require('./actions/operationService');
const { registerOperationRoutes } = require('./routes/operationRoutes');
const { OperationRecoveryWorker } = require('./actions/operationRecoveryWorker');
const { HealthCheckWorker } = require('./collectors/healthCheckWorker');
const { LogCollector } = require('./collectors/logCollector');
const { providerByName } = require('../providers/providerFactory');

async function createOperationsRuntime({ config, pool, logger, app, getBot, getPollingHealth, onDeviceRevoked, overrides = {} }) {
  if (!config.operationsEnabled) return { enabled: false, async start() {}, async close() {} };
  const repository = overrides.repository || new OperationsRepository(pool);
  const host = await repository.ensureHost({ hostKey: config.operationsHostKey, label: config.operationsHostLabel });
  const client = overrides.client || new HostAgentClient({ socketPath: config.operationsSocketPath, authenticatorPath: config.operationsAuthenticatorPath });
  const sseHub = overrides.sseHub || new SseHub();
  const incidentNotifier = overrides.incidentNotifier || new IncidentNotifier({ getBot, ownerTelegramId: config.operationsOwnerTelegramId, panelOrigin: config.operationsPublicOrigin, logger });
  const incidentEngine = overrides.incidentEngine || new IncidentEngine({ repository, hostId: host.id, notifier: incidentNotifier });
  const collector = overrides.collector || new CollectorWorker({
    client, repository, hostId: host.id, intervalMs: config.operationsPollIntervalMs, logger,
    onSnapshot: (payload) => sseHub.publish('snapshot', payload),
    onEvent: (payload) => sseHub.publish('event', payload),
    incidentEngine,
  });
  const rollupWorker = overrides.rollupWorker || new RollupWorker({ repository, logger });
  const retentionWorker = overrides.retentionWorker || new RetentionWorker({ repository, logger, incidentEngine });
  const logCollector = new LogCollector({ client, repository, hostId: host.id, logger });
  const healthCheckWorker = new HealthCheckWorker({ pool, repository, hostId: host.id, incidentEngine, getPollingHealth, logger,
    provider: config.modelProvider === 'echo' ? null : providerByName(config.modelProvider, config) });
  const sessionRepository = overrides.sessionRepository || new PanelSessionRepository(pool);
  const sessionService = overrides.sessionService || new SessionService({ repository: sessionRepository });
  const requireSession = requirePanelSession(sessionRepository);
  const sameOrigin = requireSameOrigin(config.operationsPublicOrigin);
  app.addHook('onRequest', requireOperationsHost(config.operationsPublicOrigin));
  const notifyApproval = async (request, label) => {
    const bot = getBot && getBot(); if (!bot || !bot.api) throw new Error('Telegram approval is unavailable');
    await bot.api.sendMessage(config.operationsOwnerTelegramId, `Доступ к Operations Panel: ${label}`, { reply_markup: { inline_keyboard: [[
      { text: 'Разрешить', callback_data: `ops:allow:${request.id}` }, { text: 'Отклонить', callback_data: `ops:deny:${request.id}` },
    ]] } });
  };
  registerSessionRoutes(app, {
    service: sessionService, notifyApproval, requireSameOrigin: sameOrigin, requireSession,
    onSessionRevoked: (sessionId) => sseHub.closeSession(sessionId),
  });
  registerReadRoutes(app, { repository, hostId: host.id, requireSession, client, sseHub });
  const operationService = overrides.operationService || new OperationService({ repository: new OperationRepository(pool), client, hostId: host.id });
  const operationRecoveryWorker = overrides.operationRecoveryWorker || new OperationRecoveryWorker({ service: operationService, logger });
  registerOperationRoutes(app, { service: operationService, requireSession, requireSameOrigin: sameOrigin });
  const connectionService = overrides.connectionService || new ConnectionAdminService(new ConnectionAdminRepository(pool), { onDeviceRevoked });
  registerConnectionRoutes(app, { service: connectionService, requireSession, requireSameOrigin: sameOrigin });
  await registerOperationsStatic(app);
  return { enabled: true, host, repository, sessionService, approvalHandler: createTelegramApprovalHandler({ service: sessionService, ownerTelegramId: config.operationsOwnerTelegramId }), async start() { collector.start(); rollupWorker.start(); retentionWorker.start(); operationRecoveryWorker.start(); healthCheckWorker.start(); logCollector.start(); }, async close() { collector.stop(); rollupWorker.stop(); retentionWorker.stop(); operationRecoveryWorker.stop(); healthCheckWorker.stop(); logCollector.stop(); sseHub.close(); } };
}

module.exports = { createOperationsRuntime };
