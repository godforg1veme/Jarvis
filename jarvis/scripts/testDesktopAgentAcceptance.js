const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DesktopAgentClient } = require('../agents/desktopAgentClient');
const { executeToolRequest } = require('../agents/toolGateway');

function waitForTaskEvent(client, taskId, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${taskId} acceptance event`));
    }, timeoutMs);
    const onEvent = (event) => {
      if (!predicate(event)) return;
      cleanup();
      resolve(event);
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off(`task:${taskId}`, onEvent);
    };
    client.on(`task:${taskId}`, onEvent);
  });
}

async function run() {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-acceptance-'));
  const desktop = path.join(profileRoot, 'Desktop');
  const destination = path.join(desktop, 'Images');
  fs.mkdirSync(desktop, { recursive: true });
  fs.writeFileSync(path.join(desktop, 'one.png'), 'one');
  fs.writeFileSync(path.join(desktop, 'two.png'), 'two');

  const testEnv = { ...process.env, USERPROFILE: profileRoot };
  const client = new DesktopAgentClient({
    env: testEnv,
    toolExecutor: (request, executionOptions = {}) => executeToolRequest(request, {
      ...executionOptions,
      env: testEnv,
      allowRoots: [profileRoot],
      shell: {
        openPath: async () => '',
        showItemInFolder: () => {},
        trashItem: async (targetPath) => fs.rmSync(targetPath, { force: true, recursive: true }),
      },
    }),
  });

  client.start();
  try {
    await client.waitUntilReady();
    const { taskId } = client.startTask(
      'Agent, find all png on desktop and move up to 20 files to Images',
      { taskId: 'controlled-acceptance' },
    );

    const inputWait = waitForTaskEvent(client, taskId, (event) => event.type === 'needs_input');
    await inputWait;
    client.sendTaskAction(taskId, 'user_choice', { index: 0, choice: 'Create on desktop' });

    await waitForTaskEvent(client, taskId, (event) => event.type === 'needs_confirmation'
      && event.payload.request.action === 'file.create_folder');
    const folderConfirmation = await client.confirmPendingTool(taskId);
    assert.strictEqual(folderConfirmation.ok, true);

    await waitForTaskEvent(client, taskId, (event) => event.type === 'needs_confirmation'
      && event.payload.request.action === 'file.move_batch');
    const moveConfirmation = await client.confirmPendingTool(taskId, { strongConfirmed: true });
    assert.strictEqual(moveConfirmation.ok, true);

    const report = await waitForTaskEvent(client, taskId, (event) => event.type === 'final_report');
    assert.strictEqual(report.payload.moved, 2);
    assert.strictEqual(fs.existsSync(path.join(desktop, 'one.png')), false);
    assert.strictEqual(fs.existsSync(path.join(desktop, 'two.png')), false);
    assert.strictEqual(fs.readFileSync(path.join(destination, 'one.png'), 'utf8'), 'one');
    assert.strictEqual(fs.readFileSync(path.join(destination, 'two.png'), 'utf8'), 'two');
    console.log('[testDesktopAgentAcceptance] controlled end-to-end move flow passed');
  } finally {
    client.stop();
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
