const test = require('node:test');
const assert = require('node:assert/strict');
const { FeedbackAggregator } = require('../src/life/preferences/feedbackAggregator');

const USER = '11111111-1111-4111-8111-111111111111';

test('repeated negative feedback derives an explained suppression without double-counting replay', async () => {
  const writes = [];
  const repository = {
    async listProposalFeedback({ userId }) {
      assert.equal(userId, USER);
      return [
        { id: 'a', target_id: 'proposal-a', kind: 'dismissed', source_rule: 'stalled_project' },
        { id: 'b', target_id: 'proposal-b', kind: 'not_useful', source_rule: 'stalled_project' },
        { id: 'c', target_id: 'proposal-c', kind: 'suppress_similar', source_rule: 'stalled_project' },
        { id: 'replayed-c', target_id: 'proposal-c', kind: 'suppress_similar', source_rule: 'stalled_project' },
        { id: 'd', target_id: 'proposal-d', kind: 'useful', source_rule: 'stalled_project' },
      ];
    },
    async get() { return null; },
    async setDerived(input) { writes.push(input); return { preference_key: input.key, value: input.value, source: 'derived' }; },
  };
  const result = await new FeedbackAggregator({ repository }).aggregate({ userId: USER });
  assert.equal(result.updated, true);
  assert.deepEqual(writes[0].value, ['stalled_project']);
  assert.equal(writes[0].evidenceCount, 3);
  assert.match(writes[0].explanation, /повторной отрицательной/);
});

test('explicit preference always wins over derived feedback', async () => {
  let writes = 0;
  const explicit = { source: 'explicit', value: [] };
  const repository = {
    async listProposalFeedback() { return [{ id: 'a', kind: 'dismissed', source_rule: 'rule' }]; },
    async get() { return explicit; },
    async setDerived() { writes += 1; },
  };
  const result = await new FeedbackAggregator({ repository, threshold: 2 }).aggregate({ userId: USER });
  assert.equal(result.reason, 'explicit_preference');
  assert.equal(writes, 0);
});

test('no derived preference is created without new post-deletion evidence', async () => {
  let writes = 0;
  const repository = {
    async listProposalFeedback() { return []; }, async get() { return null; },
    async setDerived() { writes += 1; },
  };
  const result = await new FeedbackAggregator({ repository }).aggregate({ userId: USER });
  assert.equal(result.reason, 'insufficient_evidence');
  assert.equal(writes, 0);
});
