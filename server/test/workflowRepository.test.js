const assert = require('node:assert/strict');
const test = require('node:test');
const { WorkflowRepository } = require('../src/orchestrator/workflowRepository');

test('workflow reads and compare-and-swap updates are always owner-scoped and parameterized', async () => {
  const calls = [];
  const repository = new WorkflowRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });
  await repository.getForUser({ userId: 'owner-a', workflowId: 'workflow-a' });
  await repository.update({
    userId: 'owner-a', workflowId: 'workflow-a', expectedRevision: 3,
    status: 'awaiting_result', state: { pendingCommandId: 'command-a' },
  });
  assert.match(calls[0].sql, /id = \$1 AND user_id = \$2/);
  assert.deepEqual(calls[0].params, ['workflow-a', 'owner-a']);
  assert.match(calls[1].sql, /revision = \$3/);
  assert.equal(calls[1].params[1], 'owner-a');
  assert.equal(calls[1].sql.includes('owner-a'), false);
});

test('active workflow lookup is bound to conversation, channel, owner and source Desktop', async () => {
  const calls = [];
  const repository = new WorkflowRepository({ async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } });
  await repository.getActiveForConversation({
    userId: 'owner-a', conversationId: 'conversation-a', originChannel: 'desktop', originDeviceId: 'device-a',
  });
  assert.match(calls[0].sql, /user_id = \$1 AND conversation_id = \$2 AND origin_channel = \$3/);
  assert.deepEqual(calls[0].params, ['owner-a', 'conversation-a', 'desktop', 'device-a']);
});
