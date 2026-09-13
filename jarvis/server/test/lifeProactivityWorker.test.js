const test = require('node:test');
const assert = require('node:assert/strict');
const { ProactivityWorker } = require('../src/life/proactivityWorker');

const ID = '11111111-1111-4111-8111-111111111111';
test('due commitments create one evidence-backed safe proposal and never execute tools', async () => {
  const proposals = [];
  const worker = new ProactivityWorker({
    now: () => new Date('2026-09-13T10:00:00Z'),
    repository: {
      async expireProposals() {},
      async listDueCommitmentsForWorker() { return [{ id: ID, user_id: ID, source_event_id: ID, title: 'Продолжить Life OS', due_at: new Date('2026-09-13T09:00:00Z'), area_id: null, project_id: null }]; },
    },
    eventRepository: { async getForUser() { return { id: ID, user_id: ID, event_type: 'message.received', source_channel: 'desktop', source_device_id: ID, structured_data: { conversationId: ID } }; } },
    proposalService: { async create(input) { proposals.push(input); return { id: ID }; } },
  });
  assert.equal(await worker.tick(), 1);
  assert.equal(proposals[0].riskClass, 'safe');
  assert.equal(proposals[0].actionName, null);
  assert.deepEqual(proposals[0].evidenceEventIds, [ID]);
});
