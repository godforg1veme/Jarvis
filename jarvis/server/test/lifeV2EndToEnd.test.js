const test = require('node:test');
const assert = require('node:assert/strict');
const { LifeEventGateway } = require('../src/life/lifeEventGateway');
const { LifeEnrichmentService } = require('../src/life/lifeEnrichmentService');
const { LifeLinker } = require('../src/life/lifeLinker');
const { CommitmentDetector } = require('../src/life/commitmentDetector');
const { PriorityEngine } = require('../src/life/priority/priorityEngine');
const { ProactivityWorker } = require('../src/life/proactivityWorker');
const { ProactivityEngine } = require('../src/life/proactivity/proactivityEngine');
const { ProposalService } = require('../src/life/proposalService');
const { createActionManifest } = require('../src/orchestrator/actionManifest');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';
const OTHER_DEVICE = '44444444-4444-4444-8444-444444444444';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const PROJECT = '66666666-6666-4666-8666-666666666666';
const AREA = '77777777-7777-4777-8777-777777777777';
const REMINDER = '88888888-8888-4888-8888-888888888888';
const NOW = new Date('2026-09-13T17:00:00+03:00');
const PREPARATION_TIME = new Date('2026-09-14T17:00:00+03:00');

function idFor(index) { return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`; }

class EventStore {
  constructor() { this.rows = []; this.byKey = new Map(); }
  async create(input) {
    const key = `${input.userId}:${input.deduplicationKey}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const row = { id: idFor(this.rows.length + 1), user_id: input.userId, event_type: input.eventType,
      occurred_at: new Date(input.occurredAt), recorded_at: NOW, source_channel: input.sourceChannel,
      source_device_id: input.sourceDeviceId || null, summary: input.summary,
      structured_data: input.structuredData || {}, confidence: input.confidence ?? 1,
      trust_level: input.trustLevel, privacy_class: input.privacyClass || 'personal', links: [] };
    this.rows.push(row); this.byKey.set(key, row); return row;
  }
  ownerRows(userId) { return this.rows.filter((row) => row.user_id === userId); }
}

class ProjectionStore {
  constructor() {
    this.projects = [{ id: PROJECT, user_id: USER, area_id: AREA, name: 'Life OS', summary: 'Integrated loop', status: 'active', updated_at: NOW }];
    this.links = []; this.commitments = [];
  }
  async listProjects({ userId }) { return this.projects.filter((row) => row.user_id === userId); }
  async getProject({ userId, projectId }) { return this.projects.find((row) => row.user_id === userId && row.id === projectId) || null; }
  async createLink(input) {
    const existing = this.links.find((row) => row.user_id === input.userId && row.event_id === input.eventId && row.target_type === input.targetType && row.target_id === input.targetId);
    if (existing) return existing;
    const row = { id: idFor(100 + this.links.length), user_id: input.userId, event_id: input.eventId,
      target_type: input.targetType, target_id: input.targetId, relation_type: input.relationType,
      origin: input.origin, confidence: input.confidence };
    this.links.push(row); return row;
  }
  async create(input) {
    const existing = this.commitments.find((row) => row.user_id === input.userId && row.source_event_id === input.sourceEventId);
    if (existing) return existing;
    const row = { id: idFor(200 + this.commitments.length), user_id: input.userId, source_event_id: input.sourceEventId,
      area_id: input.areaId, project_id: input.projectId, person_id: input.personId, kind: input.kind,
      title: input.title, status: 'open', due_at: input.dueAt, due_window_end_at: input.dueWindowEndAt,
      recurrence: input.recurrence, confidence: input.confidence, revision: 1 };
    this.commitments.push(row); return row;
  }
  async get({ userId, commitmentId }) { return this.commitments.find((row) => row.user_id === userId && row.id === commitmentId) || null; }
}

class ProposalStore {
  constructor(eventStore) { this.eventStore = eventStore; this.rows = []; this.byCooldown = new Map(); }
  async createProposal(input) {
    const key = `${input.userId}:${input.cooldownKey}`;
    if (this.byCooldown.has(key)) { const error = new Error('duplicate'); error.code = '23505'; throw error; }
    if (input.evidenceEventIds.some((id) => !this.eventStore.ownerRows(input.userId).some((event) => event.id === id))) return null;
    const row = { id: idFor(300 + this.rows.length), user_id: input.userId, project_id: input.projectId,
      commitment_id: input.commitmentId, title: input.title, explanation: input.explanation, status: 'open',
      risk_class: input.riskClass, action_name: input.actionName, action_arguments: input.actionArguments,
      source_rule: input.sourceRule, confidence: input.confidence, origin_channel: input.originChannel,
      origin_conversation_id: input.originConversationId, origin_device_id: input.originDeviceId,
      expires_at: input.expiresAt, revision: 1 };
    this.rows.push(row); this.byCooldown.set(key, row); return row;
  }
  async getProposal({ userId, proposalId }) { return this.rows.find((row) => row.user_id === userId && row.id === proposalId) || null; }
  async transitionProposal({ userId, proposalId, revision, fromStatuses, status, workflowId = null }) {
    const row = await this.getProposal({ userId, proposalId });
    if (!row || row.revision !== revision || !fromStatuses.includes(row.status)) return null;
    row.status = status; row.revision += 1; if (workflowId) row.workflow_id = workflowId; return { ...row };
  }
}

test('Life OS v2 carries one Russian commitment through linking, priority, proposal, origin confirmation and verified result exactly once', async () => {
  const events = new EventStore(); const projections = new ProjectionStore(); const proposals = new ProposalStore(events);
  const gateway = new LifeEventGateway({ repository: events });
  const source = await gateway.record({ userId: USER, eventType: 'voice.transcribed', occurredAt: NOW,
    sourceChannel: 'desktop', sourceRef: 'desktop:e2e:voice', sourceDeviceId: DEVICE,
    deduplicationKey: 'e2e:voice:1', summary: 'Завтра вечером я продолжу проект Life OS',
    structuredData: { conversationId: CONVERSATION }, trustLevel: 'user', privacyClass: 'personal' });
  const replay = await gateway.record({ userId: USER, eventType: 'voice.transcribed', occurredAt: NOW,
    sourceChannel: 'desktop', sourceRef: 'desktop:e2e:voice', sourceDeviceId: DEVICE,
    deduplicationKey: 'e2e:voice:1', summary: 'Завтра вечером я продолжу проект Life OS',
    structuredData: { conversationId: CONVERSATION }, trustLevel: 'user', privacyClass: 'personal' });
  assert.equal(replay.id, source.id);

  const enrichment = new LifeEnrichmentService({ linker: new LifeLinker({ repository: projections }),
    commitmentDetector: new CommitmentDetector({ now: () => NOW }), commitmentRepository: projections, gateway });
  const enriched = await enrichment.enrich(source);
  assert.equal(enriched.linked.project.id, PROJECT);
  assert.equal(enriched.linked.link.origin, 'trusted');
  assert.equal(enriched.commitment.project_id, PROJECT);
  assert.match(enriched.commitment.due_at.toISOString(), /^2026-09-14T1[5-9]:/);
  assert.ok(enriched.commitment.due_window_end_at > enriched.commitment.due_at);

  const priority = await new PriorityEngine({ now: () => NOW }).evaluate({ userId: USER,
    projects: projections.projects, areas: [{ id: AREA }], commitments: projections.commitments,
    events: [{ ...source, links: [{ targetType: 'project', targetId: PROJECT }] }], states: [], mode: { mode: 'work' }, preferences: [], persist: false });
  assert.equal(priority.selected.project.id, PROJECT);
  assert.ok(priority.selected.factors.some((factor) => factor.code === 'commitments.open'));

  let desktopDispatches = 0;
  const proposalService = new ProposalService({ repository: proposals, gateway, manifest: createActionManifest(), now: () => PREPARATION_TIME,
    orchestrator: { async executeDeclaredProposal(input) { desktopDispatches += 1; assert.equal(input.actionName, 'workspace.prepare'); assert.equal(input.originDeviceId, DEVICE); await gateway.record({ userId: input.userId, eventType: 'workflow.succeeded', occurredAt: NOW, sourceChannel: 'orchestrator', sourceRef: 'workflow:e2e', deduplicationKey: 'workflow:e2e:terminal', summary: 'Рабочее пространство подтверждено Desktop', structuredData: { proposalId: input.proposalId }, trustLevel: 'trusted', privacyClass: 'personal' }); return { pending: false, status: 'succeeded', workflowId: idFor(400) }; } } });
  const engine = new ProactivityEngine({ proposalService, manifest: createActionManifest(), now: () => PREPARATION_TIME,
    repository: { async countOpenForRule() { return 0; }, async countCreatedSince() { return 0; } } });
  const reminderEvent = await gateway.record({ userId: USER, eventType: 'reminder.delivered', occurredAt: PREPARATION_TIME,
    sourceChannel: 'desktop', sourceRef: 'reminder:e2e', sourceDeviceId: DEVICE,
    deduplicationKey: 'reminder:e2e:delivered', summary: 'Напоминание доставлено',
    structuredData: { reminderId: REMINDER, conversationId: CONVERSATION }, trustLevel: 'trusted', privacyClass: 'personal' });
  const worker = new ProactivityWorker({ engine, now: () => PREPARATION_TIME, reminderRepository: { async get({ userId }) { return userId === USER ? { id: REMINDER, commitment_id: enriched.commitment.id } : null; } },
    commitmentRepository: projections, projectionRepository: projections });
  const created = await worker.evaluateEvent(reminderEvent);
  assert.equal(created.length, 1); assert.equal(created[0].action_name, 'workspace.prepare');
  assert.deepEqual(created[0].action_arguments, { projectId: PROJECT, capabilityClasses: ['applications', 'files'] });

  assert.equal(await proposalService.confirm({ userId: OTHER, proposalId: created[0].id, revision: 1, originChannel: 'desktop', originDeviceId: DEVICE }), null);
  assert.equal(await proposalService.confirm({ userId: USER, proposalId: created[0].id, revision: 1, originChannel: 'telegram', originConversationId: CONVERSATION }), null);
  assert.equal(await proposalService.confirm({ userId: USER, proposalId: created[0].id, revision: 1, originChannel: 'desktop', originDeviceId: OTHER_DEVICE }), null);
  const completed = await proposalService.confirm({ userId: USER, proposalId: created[0].id, revision: 1, originChannel: 'desktop', originDeviceId: DEVICE });
  assert.equal(completed.status, 'completed'); assert.equal(desktopDispatches, 1);
  assert.equal(await proposalService.confirm({ userId: USER, proposalId: created[0].id, revision: completed.revision, originChannel: 'desktop', originDeviceId: DEVICE }), null);
  assert.equal(desktopDispatches, 1);
  assert.equal(events.ownerRows(USER).filter((event) => event.event_type === 'workflow.succeeded').length, 1);
  assert.equal(events.ownerRows(OTHER).length, 0);
  assert.equal(JSON.stringify(events.rows).includes('action_arguments'), false);
});

test('an unknown terminal result stays unknown and replay never creates a second dispatch', async () => {
  const events = new EventStore(); const proposals = new ProposalStore(events); const gateway = new LifeEventGateway({ repository: events });
  const evidence = await gateway.record({ userId: USER, eventType: 'workflow.outcome_unknown', occurredAt: NOW,
    sourceChannel: 'orchestrator', sourceRef: 'unknown:e2e', sourceDeviceId: DEVICE, deduplicationKey: 'unknown:e2e',
    summary: 'Результат требует сверки', structuredData: { conversationId: CONVERSATION }, trustLevel: 'trusted', privacyClass: 'personal' });
  let dispatches = 0;
  const service = new ProposalService({ repository: proposals, gateway, manifest: createActionManifest(), now: () => NOW,
    orchestrator: { async executeDeclaredProposal() { dispatches += 1; return { pending: false, status: 'outcome_unknown', workflowId: idFor(500) }; } } });
  const proposal = await service.create({ userId: USER, projectId: PROJECT, title: 'Сверить рабочее пространство', explanation: 'Предыдущий результат неизвестен.', sourceRule: 'e2e.unknown', sourceRuleVersion: 1, confidence: 1, riskClass: 'changing', actionName: 'workspace.prepare', actionArguments: { projectId: PROJECT, capabilityClasses: ['applications'] }, originChannel: 'desktop', originConversationId: CONVERSATION, originDeviceId: DEVICE, cooldownKey: 'e2e:unknown', expiresAt: new Date(NOW.getTime() + 3600000), evidenceEventIds: [evidence.id] });
  const unknown = await service.confirm({ userId: USER, proposalId: proposal.id, revision: 1, originChannel: 'desktop', originDeviceId: DEVICE });
  assert.equal(unknown.status, 'outcome_unknown'); assert.equal(dispatches, 1);
  assert.equal(await service.confirm({ userId: USER, proposalId: proposal.id, revision: unknown.revision, originChannel: 'desktop', originDeviceId: DEVICE }), null);
  assert.equal(dispatches, 1);
});
