const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DesktopAgentClient } = require('../agents/desktopAgentClient');
const { appendTask, pruneTasks, readHistory, updateTask } = require('../agents/agentHistory');

async function testClient() {
  const client = new DesktopAgentClient();
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
  } finally {
    client.stop();
  }
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
  testHistory();
  console.log('[testDesktopAgentClient] client and history tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
