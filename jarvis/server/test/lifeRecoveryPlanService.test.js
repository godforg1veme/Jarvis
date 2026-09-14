const test = require('node:test');
const assert = require('node:assert/strict');
const { RecoveryPlanService } = require('../src/life/recovery/recoveryPlanService');

const USER = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const PLAN = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const DEVICE = '55555555-5555-4555-8555-555555555555';
const CONVERSATION = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-09-14T10:00:00Z');
function context(revision = 4) { return { project: { id: PROJECT, name: 'Life OS', revision }, verifiedFacts: [{ summary: 'Факт' }], documents: [{ id: EVENT, name: 'spec.md' }], continuation: { eventId: EVENT } }; }
function row(overrides = {}) { return { id: PLAN, project_id: PROJECT, source_context_revision: 4, summary: 'Восстановить Life OS', creation_reason: 'user_requested', status: 'ready', origin_channel: 'desktop', origin_device_id: DEVICE, origin_conversation_id: CONVERSATION, expires_at: '2026-09-14T12:00:00Z', revision: 1, steps: [], ...overrides }; }

test('recovery preview is revision-bound and exposes no local paths or frozen arguments', async () => {
  const inputs = [];
  const service = new RecoveryPlanService({ repository: { async create(input) { inputs.push(input); return row({ steps: input.steps.map((step, id) => ({ id: String(id), step_type: step.stepType, risk_class: step.riskClass, action_name: step.actionName, label: step.label, position: step.position, depends_on_positions: [] })) }); } },
    contextService: { async recover() { return context(); } }, conversationRepository: { async getOrCreate() { return { id: CONVERSATION }; } }, now: () => NOW });
  assert.equal(await service.createPreview({ userId: USER, projectId: PROJECT, sourceContextRevision: 3, originChannel: 'desktop', originDeviceId: DEVICE }), null);
  const plan = await service.createPreview({ userId: USER, projectId: PROJECT, sourceContextRevision: 4, originChannel: 'desktop', originDeviceId: DEVICE });
  assert.equal(plan.steps.at(-1).action, 'workspace.prepare');
  assert.equal(plan.steps.at(-1).risk, 'changing');
  assert.doesNotMatch(JSON.stringify(plan), /resourceRef|actionArguments|localPath/);
  assert.equal(inputs[0].originConversationId, CONVERSATION);
});

test('proposal freezes workspace action and stale or expired plans fail closed', async () => {
  const proposals = [];
  const repository = { async get() { return row(); }, async transition(input) { return row({ status: input.status, revision: 2 }); } };
  const service = new RecoveryPlanService({ repository, contextService: { async recover() { return context(); } },
    proposalService: { async create(input) { proposals.push(input); return { id: EVENT }; } }, now: () => NOW });
  const result = await service.propose({ userId: USER, planId: PLAN, revision: 1 });
  assert.equal(result.proposalId, EVENT);
  assert.deepEqual(proposals[0].actionArguments, { projectId: PROJECT, recoveryPlanId: PLAN, capabilityClasses: ['applications', 'files'] });
  assert.equal(proposals[0].originDeviceId, DEVICE);
});

test('unknown workspace result is preserved and never treated as success', async () => {
  const calls = [];
  const service = new RecoveryPlanService({ repository: { async get() { return row({ status: 'executing' }); }, async completeFromWorkflow(input) { calls.push(input); return row({ status: input.status }); } } });
  const result = await service.applyWorkflowResult({ userId: USER, planId: PLAN, status: 'outcome_unknown' });
  assert.equal(result.status, 'outcome_unknown');
  assert.match(calls[0].resultSummary, /повтор не выполнялся/);
});
