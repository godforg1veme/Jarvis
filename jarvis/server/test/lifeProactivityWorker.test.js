const test = require('node:test');
const assert = require('node:assert/strict');
const { ProactivityWorker } = require('../src/life/proactivityWorker');
const { createActionManifest } = require('../src/orchestrator/actionManifest');

const ID = '11111111-1111-4111-8111-111111111111';
test('due commitments create one evidence-backed actionable proposal and never execute tools', async () => {
  const proposals = [];
  const worker = new ProactivityWorker({
    now: () => new Date('2026-09-13T10:00:00Z'),
    repository: {
      async expireProposals() {},
      async listDueCommitmentsForWorker() { return [{ id: ID, revision: 1, user_id: ID, source_event_id: ID, title: 'Продолжить Life OS', due_at: new Date('2026-09-13T09:00:00Z'), area_id: null, project_id: null }]; },
    },
    eventRepository: { async getForUser() { return { id: ID, user_id: ID, event_type: 'message.received', source_channel: 'desktop', source_device_id: ID, structured_data: { conversationId: ID } }; } },
    proposalService: { async create(input) { proposals.push(input); return { id: ID }; } },
    manifest: createActionManifest(),
  });
  assert.equal(await worker.tick(), 1);
  assert.equal(proposals[0].riskClass, 'changing');
  assert.equal(proposals[0].actionName, 'life.commitment.reschedule');
  assert.deepEqual(proposals[0].evidenceEventIds, [ID]);
});

test('delivered reminder resolves its owner-scoped commitment before proposing workspace preparation', async () => {
  const calls = [];
  const worker = new ProactivityWorker({
    reminderRepository: { async get(input) { calls.push(input); return { commitment_id: ID }; } },
    commitmentRepository: { async get(input) { calls.push(input); return { id: ID, revision: 1, title: 'Life OS', due_at: '2026-09-13T11:00:00Z', project_id: ID }; } },
    projectionRepository: { async getProject(input) { calls.push(input); return { id: ID, name: 'Life OS', status: 'active' }; } },
    proposalService: { async create(input) { return { id: ID, ...input }; } }, manifest: createActionManifest(),
    now: () => new Date('2026-09-13T10:00:00Z'),
  });
  const rows = await worker.evaluateEvent({ id: ID, user_id: ID, event_type: 'reminder.delivered', source_channel: 'desktop', source_device_id: ID,
    structured_data: { reminderId: ID, conversationId: ID }, confidence: 1 });
  assert.equal(rows[0].actionName, 'workspace.prepare');
  assert.equal(calls.every((input) => input.userId === ID), true);
});
