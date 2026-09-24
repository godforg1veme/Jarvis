const { recordSimpleEvent } = require('./lifeSourceEvents');

class ProposalService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.gateway = options.gateway;
    this.orchestrator = options.orchestrator || null;
    this.manifest = options.manifest || null;
    this.recoveryPlanService = options.recoveryPlanService || null;
    this.commitmentLifecycleService = options.commitmentLifecycleService || null;
    this.now = options.now || (() => new Date());
  }

  async create(input) {
    try {
      if (input.actionName && this.manifest) {
        const action = this.manifest.require(input.actionName);
        input = { ...input, actionArguments: action.validateArgs(input.actionArguments || {}) };
        const changing = ['requires_confirmation', 'requires_strong_confirmation'].includes(action.policy);
        if ((input.riskClass === 'changing') !== changing) throw new Error('proposal risk does not match action policy');
      }
      const proposal = await this.repository.createProposal(input);
      await recordSimpleEvent(this.gateway, {
        userId: input.userId, eventType: 'proposal.created', sourceChannel: 'life_os',
        sourceRef: `proposal:${proposal.id}`, deduplicationKey: `proposal-created:${proposal.id}`,
        summary: `Предложение: ${proposal.title}`,
        structuredData: { proposalId: proposal.id, state: proposal.status,
          ...(proposal.project_id ? { projectId: proposal.project_id } : {}),
          ...(proposal.commitment_id ? { commitmentId: proposal.commitment_id } : {}) },
        trustLevel: 'inferred',
      });
      return proposal;
    } catch (error) {
      if (error && error.code === '23505') return null;
      throw error;
    }
  }

  async confirm({ userId, proposalId, revision = null, originChannel, originDeviceId = null, originConversationId = null }) {
    const proposal = await this.repository.getProposal({ userId, proposalId });
    if (!proposal || proposal.status !== 'open') return null;
    if (revision !== null && proposal.revision !== revision) return null;
    if (new Date(proposal.expires_at) <= this.now()) {
      await this.repository.transitionProposal({ userId, proposalId, revision: proposal.revision, fromStatuses: ['open'], status: 'expired' });
      return null;
    }
    if (proposal.origin_channel !== originChannel) return null;
    if (originChannel === 'desktop' && proposal.origin_device_id !== originDeviceId) return null;
    if (originChannel === 'telegram' && proposal.origin_conversation_id !== originConversationId) return null;

    const confirmed = await this.repository.transitionProposal({
      userId, proposalId, revision: proposal.revision, fromStatuses: ['open'], status: 'confirmed', confirmed: true,
    });
    if (!confirmed) return null;
    await recordSimpleEvent(this.gateway, {
      userId, eventType: 'proposal.confirmed', sourceChannel: 'life_os',
      sourceRef: `proposal:${proposalId}`, deduplicationKey: `proposal-confirmed:${proposalId}`,
      sourceDeviceId: originDeviceId,
      summary: `Подтверждено предложение: ${confirmed.title}`,
      structuredData: { proposalId, state: 'confirmed' },
    });

    if (!confirmed.action_name) {
      return this.repository.transitionProposal({
        userId, proposalId, revision: confirmed.revision, fromStatuses: ['confirmed'], status: 'completed',
      });
    }
    if (!this.orchestrator || typeof this.orchestrator.executeDeclaredProposal !== 'function') {
      return this.repository.transitionProposal({
        userId, proposalId, revision: confirmed.revision, fromStatuses: ['confirmed'], status: 'failed',
      });
    }
    try {
      const result = await this.orchestrator.executeDeclaredProposal({
        userId, proposalId, conversationId: confirmed.origin_conversation_id,
        originChannel, originDeviceId, text: confirmed.title,
        projectId: confirmed.project_id || null,
        commitmentId: confirmed.commitment_id || null,
        actionName: confirmed.action_name, actionArguments: confirmed.action_arguments || {},
      });
      const terminalStatus = result.pending ? 'executing'
        : result.status === 'outcome_unknown' ? 'outcome_unknown'
          : result.status === 'failed' ? 'failed' : 'completed';
      const updated = await this.repository.transitionProposal({
        userId, proposalId, revision: confirmed.revision, fromStatuses: ['confirmed'],
        status: terminalStatus, workflowId: result.workflowId || null,
      });
      const planId = confirmed.action_arguments && confirmed.action_arguments.recoveryPlanId;
      if (updated && !result.pending && planId && this.recoveryPlanService) await this.recoveryPlanService.applyWorkflowResult({
        userId, planId, status: result.partial === true ? 'partial' : result.status || 'succeeded',
      });
      if (updated && result.status === 'succeeded' && confirmed.commitment_id && this.commitmentLifecycleService) {
        await this.commitmentLifecycleService.completeFromVerifiedAction({
          userId, commitmentId: confirmed.commitment_id, workflowId: result.workflowId,
        });
      }
      return updated;
    } catch (_) {
      return this.repository.transitionProposal({
        userId, proposalId, revision: confirmed.revision, fromStatuses: ['confirmed'], status: 'failed',
      });
    }
  }

  async dismiss({ userId, proposalId, revision = null, originChannel, originDeviceId = null, originConversationId = null }) {
    const proposal = await this.repository.getProposal({ userId, proposalId });
    if (!proposal || proposal.status !== 'open' || proposal.origin_channel !== originChannel) return null;
    if (revision !== null && proposal.revision !== revision) return null;
    if (originChannel === 'desktop' && proposal.origin_device_id !== originDeviceId) return null;
    if (originChannel === 'telegram' && proposal.origin_conversation_id !== originConversationId) return null;
    const dismissed = await this.repository.transitionProposal({
      userId, proposalId, revision: proposal.revision, fromStatuses: ['open'], status: 'dismissed',
    });
    if (dismissed) await recordSimpleEvent(this.gateway, {
      userId, eventType: 'proposal.dismissed', sourceChannel: 'life_os',
      sourceRef: `proposal:${proposalId}`, deduplicationKey: `proposal-dismissed:${proposalId}`,
      sourceDeviceId: originDeviceId, summary: `Отклонено предложение: ${dismissed.title}`,
      structuredData: { proposalId, state: 'dismissed' },
    });
    const planId = dismissed?.action_arguments && dismissed.action_arguments.recoveryPlanId;
    if (planId && this.recoveryPlanService) await this.recoveryPlanService.cancel({ userId, planId });
    return dismissed;
  }

  async onWorkflowStatus(workflow) {
    const proposalId = workflow && workflow.state && workflow.state.proposalId;
    if (!proposalId || !['succeeded', 'failed', 'outcome_unknown'].includes(workflow.status)) return null;
    const proposal = await this.repository.getProposal({ userId: workflow.user_id, proposalId });
    if (!proposal || proposal.workflow_id !== workflow.id || !['confirmed', 'executing'].includes(proposal.status)) return null;
    const updated = await this.repository.transitionProposal({
      userId: workflow.user_id, proposalId, revision: proposal.revision,
      fromStatuses: ['confirmed', 'executing'],
      status: workflow.status === 'succeeded' ? 'completed' : workflow.status === 'failed' ? 'failed' : 'outcome_unknown',
      workflowId: workflow.id,
    });
    const planId = proposal.action_arguments && proposal.action_arguments.recoveryPlanId;
    if (updated && planId && this.recoveryPlanService) await this.recoveryPlanService.applyWorkflowResult({
      userId: workflow.user_id, planId,
      status: workflow.state?.partialResult === true ? 'partial' : workflow.status,
    });
    if (updated && workflow.status === 'succeeded' && proposal.commitment_id && this.commitmentLifecycleService) {
      await this.commitmentLifecycleService.completeFromVerifiedAction({
        userId: workflow.user_id, commitmentId: proposal.commitment_id, workflowId: workflow.id,
      });
    }
    return updated;
  }
}

module.exports = { ProposalService };
