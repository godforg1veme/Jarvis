const { createHash } = require('node:crypto');
const { publicRecoveryPlan } = require('./recoveryPlanPublic');

function recoveryKey(userId, projectId, revision, channel, deviceId) {
  return `recovery:${createHash('sha256').update([userId, projectId, revision, channel, deviceId || ''].join('\0')).digest('hex')}`;
}

class RecoveryPlanService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.contextService = options.contextService;
    this.conversationRepository = options.conversationRepository;
    this.proposalService = options.proposalService;
    this.gateway = options.gateway || null;
    this.now = options.now || (() => new Date());
  }

  async createPreview({ userId, projectId, sourceContextRevision, originChannel, originDeviceId = null, originConversationId = null, creationReason = 'user_requested' }) {
    const context = await this.contextService.recover({ userId, projectId });
    if (!context || context.project.revision !== sourceContextRevision) return null;
    if (!originConversationId && originChannel === 'desktop' && this.conversationRepository) {
      const conversation = await this.conversationRepository.getOrCreate({ userId, channel: 'desktop', externalChatId: originDeviceId });
      originConversationId = conversation.id;
    }
    const steps = [];
    for (const fact of context.verifiedFacts.slice(0, 3)) steps.push({ position: steps.length, stepType: 'show_fact', label: fact.summary, riskClass: 'safe', dependsOnPositions: [] });
    for (const document of context.documents.slice(0, 2)) steps.push({ position: steps.length, stepType: 'show_document', label: document.name, riskClass: 'safe', resourceRef: document.id, dependsOnPositions: [] });
    steps.push({ position: steps.length, stepType: 'prepare_workspace', label: `Подготовить рабочее пространство «${context.project.name}»`,
      riskClass: 'changing', actionName: 'workspace.prepare', resourceRef: projectId, dependsOnPositions: [] });
    const plan = await this.repository.create({ userId, projectId, sourceContextRevision,
      summary: `Восстановить контекст проекта «${context.project.name}»`, creationReason,
      originChannel, originConversationId, originDeviceId,
      idempotencyKey: recoveryKey(userId, projectId, sourceContextRevision, originChannel, originDeviceId),
      expiresAt: new Date(this.now().getTime() + 2 * 60 * 60 * 1000), steps });
    if (this.gateway) await this.gateway.record({ userId, eventType: 'recovery.prepared', occurredAt: this.now(), sourceChannel: 'life_os',
      sourceDeviceId: originDeviceId, sourceRef: `recovery:${plan.id}:revision:${plan.revision}`,
      deduplicationKey: `recovery-prepared:${plan.id}`, summary: plan.summary,
      structuredData: { recoveryPlanId: plan.id, projectId, state: plan.status }, trustLevel: 'user', privacyClass: 'personal' });
    return publicRecoveryPlan(plan);
  }

  async get({ userId, planId }) { return publicRecoveryPlan(await this.repository.get({ userId, planId })); }

  async propose({ userId, planId, revision }) {
    const plan = await this.repository.get({ userId, planId });
    if (!plan || plan.revision !== revision || plan.status !== 'ready' || new Date(plan.expires_at) <= this.now()) return null;
    const context = await this.contextService.recover({ userId, projectId: plan.project_id });
    if (!context || context.project.revision !== Number(plan.source_context_revision) || !context.continuation?.eventId) return null;
    const proposal = await this.proposalService.create({ userId, projectId: plan.project_id,
      title: `Подготовить «${context.project.name}»`, explanation: 'План восстановит зарегистрированные локальные приложения и материалы проекта.',
      sourceRule: 'recovery.workspace', sourceRuleVersion: 1, confidence: 1, riskClass: 'changing',
      actionName: 'workspace.prepare', actionArguments: { projectId: plan.project_id, recoveryPlanId: plan.id, capabilityClasses: ['applications', 'files'] },
      originChannel: plan.origin_channel, originConversationId: plan.origin_conversation_id,
      originDeviceId: plan.origin_device_id, cooldownKey: `recovery:${plan.id}:workspace`,
      expiresAt: plan.expires_at, evidenceEventIds: [context.continuation.eventId] });
    if (!proposal) return null;
    const updated = await this.repository.transition({ userId, planId, revision: plan.revision, fromStatuses: ['ready'], status: 'awaiting_confirmation' });
    return updated ? { plan: publicRecoveryPlan({ ...updated, steps: plan.steps }), proposalId: proposal.id } : null;
  }

  async applyWorkflowResult({ userId, planId, status }) {
    const plan = await this.repository.get({ userId, planId });
    if (!plan || !['awaiting_confirmation', 'executing'].includes(plan.status)) return null;
    const target = status === 'succeeded' ? 'completed' : status === 'outcome_unknown' ? 'outcome_unknown' : status === 'partial' ? 'partial' : 'failed';
    return this.repository.completeFromWorkflow({ userId, planId, revision: plan.revision, status: target,
      resultSummary: target === 'completed' ? 'Рабочее пространство подтверждено Desktop.' : target === 'outcome_unknown' ? 'Результат Desktop требует сверки; повтор не выполнялся.' : target === 'partial' ? 'Desktop подтвердил только часть шагов.' : 'Desktop не подтвердил подготовку.' });
  }

  async cancel({ userId, planId }) {
    const plan = await this.repository.get({ userId, planId });
    if (!plan || !['ready', 'awaiting_confirmation'].includes(plan.status)) return null;
    return this.repository.transition({ userId, planId, revision: plan.revision,
      fromStatuses: ['ready', 'awaiting_confirmation'], status: 'cancelled' });
  }
}

module.exports = { RecoveryPlanService, recoveryKey };
