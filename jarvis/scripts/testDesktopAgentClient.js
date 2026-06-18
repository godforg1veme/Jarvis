const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DesktopAgentClient } = require('../agents/desktopAgentClient');
const { appendTask, pruneTasks, readHistory, updateTask } = require('../agents/agentHistory');

async function testClient() {
  const client = new DesktopAgentClient({
    toolExecutor: async (request) => ({
      ok: true,
      action: request.action,
      results: [{ name: 'image.png', path: 'C:\\Users\\maxob\\Desktop\\image.png' }],
    }),
  });
  const events = [];
  client.on('event', (event) => events.push(event));

  client.start();
  try {
    await client.waitUntilReady();
    const pong = await client.ping();
    assert.strictEqual(pong.type, 'pong');

    const { taskId } = client.startTask('Agent, find all png on desktop and move up to 20 files to Images', {
      taskId: 'client-demo',
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for needs_input')), 5000);
      client.on(`task:${taskId}`, (event) => {
        if (event.type === 'needs_input') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    assert(events.some((event) => event.type === 'plan_draft' && event.task_id === taskId));
    assert(events.some((event) => event.type === 'tool_request' && event.task_id === taskId));
  } finally {
    client.stop();
  }
}

async function testPendingConfirmation() {
  const sent = [];
  const executorCalls = [];
  const client = new DesktopAgentClient({
    toolExecutor: async (request, options = {}) => {
      executorCalls.push({ request, options });
      if (options.confirmed) {
        return { ok: true, action: request.action };
      }
      return {
        ok: false,
        action: request.action,
        requiresConfirmation: true,
        message: 'confirm',
      };
    },
  });
  client.send = (type, payload, options = {}) => {
    sent.push({ type, payload, options });
    return 'sent';
  };

  const events = [];
  client.on('event', (event) => events.push(event));
  await client.handleToolRequest({
    type: 'tool_request',
    task_id: 'confirm-task',
    payload: {
      request_id: 'req-1',
      action: 'file.move',
      args: { from: 'a', to: 'b' },
    },
  });

  assert.strictEqual(sent.length, 0);
  assert.strictEqual(events[0].type, 'needs_confirmation');
  assert.strictEqual(client.pendingToolConfirmations.has('confirm-task'), true);

  const confirmed = await client.confirmPendingTool('confirm-task');
  assert.strictEqual(confirmed.ok, true);
  assert.strictEqual(executorCalls[1].options.confirmed, true);
  assert.strictEqual(sent[0].type, 'tool_result');
  assert.strictEqual(sent[0].payload.result.ok, true);

  const actionResult = client.sendTaskAction('confirm-task', 'continue', { note: 'ok' });
  assert.strictEqual(actionResult.ok, true);
  assert.strictEqual(sent[1].type, 'task_action');
  assert.strictEqual(sent[1].payload.action, 'continue');
  assert.strictEqual(sent[1].options.taskId, 'confirm-task');
}

function testHistory() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-history-'));
  const historyPath = path.join(tempDir, 'agent-history.json');

  appendTask({ taskId: 'one', command: 'test', status: 'created' }, {
    filePath: historyPath,
    now: '2026-06-18T00:00:00.000Z',
  });
  updateTask('one', { status: 'finalized' }, {
    filePath: historyPath,
    now: '2026-06-18T00:01:00.000Z',
  });

  const history = readHistory(historyPath);
  assert.strictEqual(history.tasks.length, 1);
  assert.strictEqual(history.tasks[0].status, 'finalized');

  const oldTasks = Array.from({ length: 120 }, (_, index) => ({
    taskId: `task-${index}`,
    createdAt: '2026-06-18T00:00:00.000Z',
  }));
  assert.strictEqual(pruneTasks(oldTasks, Date.parse('2026-06-18T00:00:00.000Z')).length, 100);
  assert.strictEqual(pruneTasks([{ taskId: 'old', createdAt: '2026-04-01T00:00:00.000Z' }], Date.parse('2026-06-18T00:00:00.000Z')).length, 0);
}

async function run() {
  await testClient();
  await testPendingConfirmation();
  testHistory();
  console.log('[testDesktopAgentClient] client and history tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
