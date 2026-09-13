const test = require('node:test');
const assert = require('node:assert/strict');
const { ContextRecoveryService } = require('../src/life/contextRecoveryService');

const ID = '11111111-1111-4111-8111-111111111111';
test('context recovery separates facts, user context, inferences, and suggestions', async () => {
  const repository = {
    async getProject() { return { id: ID, area_id: null, name: 'Life OS', summary: '', status: 'active', revision: 1, created_at: new Date(), updated_at: new Date() }; },
    async listTimeline() { return [
      { id: ID, event_type: 'workflow.completed', occurred_at: new Date(), recorded_at: new Date(), source_channel: 'orchestrator', summary: 'Готово', confidence: 1, privacy_class: 'personal', trust_level: 'trusted', links: [] },
      { id: '22222222-2222-4222-8222-222222222222', event_type: 'message.received', occurred_at: new Date(), recorded_at: new Date(), source_channel: 'telegram', summary: 'Продолжу', confidence: 1, privacy_class: 'personal', trust_level: 'user', links: [] },
    ]; },
    async listCommitments() { return []; },
    async listProposals() { return [{ id: ID, title: 'Следующий шаг', explanation: 'Есть основание', status: 'open', risk_class: 'safe', origin_channel: 'desktop', expires_at: new Date(), revision: 1, evidence: [] }]; },
  };
  const context = await new ContextRecoveryService({ repository }).recover({ userId: ID, projectId: ID });
  assert.equal(context.verifiedFacts.length, 1);
  assert.equal(context.userContext.length, 1);
  assert.equal(context.suggestedNextSteps[0].title, 'Следующий шаг');
});
