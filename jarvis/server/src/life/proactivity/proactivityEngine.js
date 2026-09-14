const { createHash } = require('node:crypto');
const { boundedProposal, originFromSignal } = require('./proactivityRule');
const approachingCommitment = require('./rules/approachingCommitment');
const overdueCommitment = require('./rules/overdueCommitment');
const stalledProject = require('./rules/stalledProject');
const failedOrUnknownAction = require('./rules/failedOrUnknownAction');
const newProjectDocument = require('./rules/newProjectDocument');
const lostContext = require('./rules/lostContext');
const scheduleConflict = require('./rules/scheduleConflict');
const freeWindow = require('./rules/freeWindow');
const deviceStateChange = require('./rules/deviceStateChange');
const forgottenTask = require('./rules/forgottenTask');
const meetingPreparation = require('./rules/meetingPreparation');
const grantedFamilyEvent = require('./rules/grantedFamilyEvent');
const smartHomeAttention = require('./rules/smartHomeAttention');

const DEFAULT_RULES = Object.freeze([
  approachingCommitment, overdueCommitment, stalledProject, failedOrUnknownAction,
  newProjectDocument, lostContext, scheduleConflict, freeWindow, deviceStateChange,
  forgottenTask, meetingPreparation, grantedFamilyEvent, smartHomeAttention,
]);

function stableUuid(...parts) {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function actionsFor(signal) {
  const eventId = signal.event?.id;
  const origin = originFromSignal(signal);
  const channel = origin.originChannel;
  const commitment = signal.commitment;
  const project = signal.project;
  const due = commitment?.due_at ? new Date(commitment.due_at)
    : signal.window?.startsAt ? new Date(signal.window.startsAt)
      : signal.familyEvent?.startsAt ? new Date(signal.familyEvent.startsAt)
        : new Date(signal.now.getTime() + 3600000);
  const newDue = signal.suggestedDueAt ? new Date(signal.suggestedDueAt) : new Date(signal.now.getTime() + 24 * 3600000);
  return {
    createReminder: {
      requestId: stableUuid(signal.ruleSeed || eventId || commitment?.id || 'reminder', signal.kind, due.toISOString()),
      title: String(commitment?.title || signal.familyEvent?.title || signal.taskTitle || 'Напоминание Life OS').slice(0, 300),
      triggerAt: due.toISOString(), timezone: signal.timezone || commitment?.timezone || 'UTC',
      deliveryChannels: [channel],
      ...(commitment?.id ? { commitmentId: commitment.id } : {}),
      ...(project?.id || commitment?.project_id ? { projectId: project?.id || commitment.project_id } : {}),
    },
    rescheduleCommitment: commitment?.id ? {
      commitmentId: commitment.id, revision: commitment.revision,
      dueAt: newDue.toISOString(), dueWindowEndAt: newDue.toISOString(),
    } : {},
    prepareWorkspace: project?.id || commitment?.project_id ? { projectId: project?.id || commitment.project_id, capabilityClasses: ['applications', 'files'] } : {},
    showDocuments: project?.id ? { projectId: project.id } : {},
    requestDeviceStatus: signal.deviceId ? { deviceId: signal.deviceId } : {},
    createTask: eventId ? {
      sourceEventId: eventId, title: String(signal.taskTitle || 'Задача Life OS').slice(0, 300),
      ...(project?.id ? { projectId: project.id } : {}),
    } : {},
    continueWorkflow: signal.workflowId ? { workflowId: signal.workflowId } : {},
  };
}

function resourceKey(signal) {
  return signal.commitment?.id || signal.project?.id || signal.workflowId || signal.deviceId || signal.event?.id || signal.kind;
}

class ProactivityEngine {
  constructor(options = {}) {
    this.rules = options.rules || DEFAULT_RULES;
    this.proposalService = options.proposalService;
    this.manifest = options.manifest;
    this.repository = options.repository || null;
    this.deliverProposal = options.deliverProposal || null;
    this.now = options.now || (() => new Date());
  }

  async evaluate(rawSignal, context = {}) {
    const signal = { ...rawSignal, now: rawSignal.now || this.now() };
    signal.actions = { ...actionsFor(signal), ...(rawSignal.actions || {}) };
    const suppressed = new Set(context.suppressedRules || []);
    if (context.enabled === false || context.quiet === true) return [];
    const onlyUrgent = ['critical_only', 'urgent_only', 'urgent_and_current', 'important'].includes(context.proposalVisibility);
    if (onlyUrgent && signal.severity !== 'critical' && signal.workflowStatus !== 'outcome_unknown') return [];
    if (this.repository?.countCreatedSince && Number.isFinite(context.maxPerDay)) {
      const start = new Date(signal.now); start.setUTCHours(0, 0, 0, 0);
      if (await this.repository.countCreatedSince({ userId: signal.event.user_id, since: start }) >= context.maxPerDay) return [];
    }
    const created = [];
    for (const rule of this.rules) {
      if (!rule.inputKinds.includes(signal.kind) || suppressed.has(rule.id)) continue;
      const proposal = boundedProposal(rule, rule.evaluate(signal, context));
      if (!proposal || proposal.confidence < rule.minimumConfidence) continue;
      const origin = originFromSignal(signal);
      if (!origin.originConversationId || (origin.originChannel === 'desktop' && !origin.originDeviceId)) continue;
      const evidenceEventIds = [...new Set(signal.evidenceEventIds || [signal.event?.id].filter(Boolean))].slice(0, 32);
      if (!evidenceEventIds.length) continue;
      let action = null;
      try {
        action = proposal.actionName ? this.manifest.require(proposal.actionName) : null;
        if (action) proposal.actionArguments = action.validateArgs(proposal.actionArguments || {});
      } catch (_) { continue; }
      const changingPolicy = action && ['requires_confirmation', 'requires_strong_confirmation'].includes(action.policy);
      if (proposal.riskClass === 'changing' !== Boolean(changingPolicy)) continue;
      if (this.repository?.countOpenForRule && await this.repository.countOpenForRule({
        userId: signal.event.user_id, sourceRule: rule.id,
        projectId: proposal.projectId || null, commitmentId: proposal.commitmentId || null,
        personId: proposal.personId || null,
      }) >= rule.maxOpen) continue;
      const bucket = Math.floor(signal.now.getTime() / rule.cooldownMs);
      const row = await this.proposalService.create({
        userId: signal.event.user_id,
        areaId: proposal.areaId || null, projectId: proposal.projectId || null,
        commitmentId: proposal.commitmentId || null, personId: proposal.personId || null,
        reminderId: proposal.reminderId || null,
        title: proposal.title, explanation: proposal.explanation,
        sourceRule: rule.id, sourceRuleVersion: rule.version, confidence: proposal.confidence,
        riskClass: proposal.riskClass, actionName: proposal.actionName || null,
        actionArguments: proposal.actionArguments || {}, ...origin,
        cooldownKey: `${rule.id}:${resourceKey(signal)}:${bucket}`.slice(0, 256),
        expiresAt: new Date(signal.now.getTime() + rule.expiresInMs), evidenceEventIds,
      });
      if (row) { created.push(row); if (this.deliverProposal) await this.deliverProposal(row); }
    }
    return created;
  }

  signalFromEvent(event, linked = null) {
    const data = event.structured_data || {};
    const base = { event, project: linked?.project || null, person: linked?.person || null, confidence: event.confidence };
    if (event.event_type === 'document.ingested' && linked?.project) return { ...base, kind: 'project_document' };
    if (event.event_type === 'reminder.delivered' && linked?.commitment) return { ...base, kind: 'commitment', commitment: linked.commitment };
    if (['workflow.failed', 'workflow.outcome_unknown'].includes(event.event_type)) return { ...base, kind: 'workflow_issue', workflowStatus: event.event_type.endsWith('failed') ? 'failed' : 'outcome_unknown', workflowId: data.workflowId };
    if (event.event_type === 'device.state_changed') return { ...base, kind: 'device_change', deviceId: data.deviceId || event.source_device_id, deviceState: data.state };
    if (event.source_channel === 'smart_home' && ['trusted', 'user'].includes(event.trust_level)) return { ...base, kind: 'smart_home', deviceId: data.deviceId, severity: data.severity };
    if (data.signalType === 'schedule_conflict') return { ...base, kind: 'schedule_conflict', commitment: linked?.commitment, conflictEvidence: true, suggestedDueAt: data.suggestedDueAt };
    if (data.signalType === 'free_window') return { ...base, kind: 'free_window', commitment: linked?.commitment, window: data.window };
    if (data.signalType === 'meeting') return { ...base, kind: 'meeting', meeting: data.meeting };
    if (data.signalType === 'forgotten_task') return { ...base, kind: 'forgotten_task', taskTitle: data.taskTitle, missedCount: data.missedCount };
    if (data.signalType === 'context_lost') return { ...base, kind: 'context_lost', hasContinuation: data.hasContinuation === true, deviceAvailable: data.deviceAvailable !== false };
    if (data.signalType === 'family_event' && linked?.authorizedFamilyGrant) return { ...base, kind: 'family_event', authorizedGrant: true, familyEvent: data.familyEvent };
    return null;
  }
}

module.exports = { DEFAULT_RULES, ProactivityEngine, actionsFor, stableUuid };
