const test = require('node:test');
const assert = require('node:assert/strict');
const { ProposalService } = require('../src/life/proposalService');

const USER = '11111111-1111-4111-8111-111111111111';
const PROPOSAL = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const COMMITMENT = '55555555-5555-4555-8555-555555555555';
const WORKFLOW = '66666666-6666-4666-8666-666666666666';

function row(overrides = {}) {
  return { id: PROPOSAL, user_id: USER, title: 'Открыть проект', explanation: 'Есть подтверждённое основание',
    status: 'open', risk_class: 'changing', action_name: 'app.launch', action_arguments: { candidateId: 'candidate-a' },
    project_id: PROJECT, commitment_id: COMMITMENT,
    origin_channel: 'desktop', origin_device_id: DEVICE, origin_conversation_id: PROPOSAL,
    expires_at: new Date('2026-09-14T10:00:00Z'), revision: 1, ...overrides };
}

test('another owner device cannot confirm an origin-bound proposal', async () => {
  const repository = { async getProposal() { return row(); } };
  const service = new ProposalService({ repository, now: () => new Date('2026-09-13T10:00:00Z') });
  assert.equal(await service.confirm({ userId: USER, proposalId: PROPOSAL, revision: 1, originChannel: 'desktop', originDeviceId: '44444444-4444-4444-8444-444444444444' }), null);
});

test('changing proposal delegates a frozen declared action and tracks execution', async () => {
  const transitions = [];
  const repository = {
    async getProposal() { return row(); },
    async transitionProposal(input) {
      transitions.push(input);
      if (input.status === 'confirmed') return row({ status: 'confirmed', revision: 2 });
      return row({ status: input.status, revision: 3, workflow_id: input.workflowId });
    },
  };
  const calls = [];
  const service = new ProposalService({ repository, gateway: { async record() {} },
    orchestrator: { async executeDeclaredProposal(input) { calls.push(input); return { pending: true, workflowId: '55555555-5555-4555-8555-555555555555' }; } },
    now: () => new Date('2026-09-13T10:00:00Z') });
  const result = await service.confirm({ userId: USER, proposalId: PROPOSAL, revision: 1, originChannel: 'desktop', originDeviceId: DEVICE });
  assert.equal(result.status, 'executing');
  assert.equal(calls[0].actionName, 'app.launch');
  assert.equal(calls[0].projectId, PROJECT);
  assert.equal(calls[0].commitmentId, COMMITMENT);
  assert.deepEqual(calls[0].actionArguments, { candidateId: 'candidate-a' });
  assert.deepEqual(transitions.map((item) => item.status), ['confirmed', 'executing']);
});

test('verified synchronous workflow completion closes only its linked commitment', async () => {
  const repository = {
    async getProposal() { return row(); },
    async transitionProposal(input) {
      return row({ status: input.status, revision: input.status === 'confirmed' ? 2 : 3, workflow_id: input.workflowId || null });
    },
  };
  const completed = [];
  const service = new ProposalService({ repository, gateway: { async record() {} },
    orchestrator: { async executeDeclaredProposal() { return { pending: false, status: 'succeeded', workflowId: WORKFLOW }; } },
    commitmentLifecycleService: { async completeFromVerifiedAction(input) { completed.push(input); return { status: 'completed' }; } },
    now: () => new Date('2026-09-13T10:00:00Z') });
  const result = await service.confirm({ userId: USER, proposalId: PROPOSAL, revision: 1, originChannel: 'desktop', originDeviceId: DEVICE });
  assert.equal(result.status, 'completed');
  assert.deepEqual(completed, [{ userId: USER, commitmentId: COMMITMENT, workflowId: WORKFLOW }]);
});

test('safe declared proposal executes after its origin-bound confirmation', async () => {
  const safe = row({ risk_class: 'safe', action_name: 'project.show_documents', action_arguments: { projectId: PROPOSAL } });
  const calls = [];
  const repository = {
    async getProposal() { return safe; },
    async transitionProposal(input) {
      return { ...safe, status: input.status, revision: input.status === 'confirmed' ? 2 : 3, workflow_id: input.workflowId || null };
    },
  };
  const service = new ProposalService({ repository, gateway: { async record() {} },
    orchestrator: { async executeDeclaredProposal(input) { calls.push(input); return { pending: false, workflowId: PROPOSAL }; } },
    now: () => new Date('2026-09-13T10:00:00Z') });
  const result = await service.confirm({ userId: USER, proposalId: PROPOSAL, revision: 1, originChannel: 'desktop', originDeviceId: DEVICE });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actionName, 'project.show_documents');
  assert.equal(result.status, 'completed');
});
