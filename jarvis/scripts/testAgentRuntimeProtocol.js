const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'agent_runtime', 'server.py');

function pythonCommand() {
  const venvPython = process.platform === 'win32'
    ? path.join(ROOT, 'agent_runtime', '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, 'agent_runtime', '.venv', 'bin', 'python');
  return require('fs').existsSync(venvPython) ? venvPython : 'python';
}

function startRuntime() {
  const child = spawn(pythonCommand(), [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PYTHONPATH: ROOT,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const events = [];
  const errors = [];
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    events.push(JSON.parse(line));
  });
  child.stderr.on('data', (chunk) => errors.push(String(chunk)));

  return { child, events, errors, rl };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for runtime event');
}

async function run() {
  const runtime = startRuntime();
  try {
    await waitFor(() => runtime.events.some((event) => event.type === 'ready'));

    runtime.child.stdin.write(JSON.stringify({ type: 'ping', id: 'ping-1' }) + '\n');
    await waitFor(() => runtime.events.some((event) => event.type === 'pong' && event.id === 'ping-1'));

    runtime.child.stdin.write(JSON.stringify({
      type: 'start_task',
      id: 'task-1',
      task_id: 'demo-task',
      payload: {
        user_command: 'Agent, find all png on desktop and move up to 20 files to Images',
      },
    }) + '\n');

    await waitFor(() => runtime.events.some((event) => event.type === 'tool_request' && event.task_id === 'demo-task'));
    const toolRequest = runtime.events.find((event) => event.type === 'tool_request' && event.task_id === 'demo-task');
    assert.strictEqual(toolRequest.payload.action, 'file.search');

    runtime.child.stdin.write(JSON.stringify({
      type: 'tool_result',
      id: 'tool-result-1',
      task_id: 'demo-task',
      payload: {
        request_id: toolRequest.payload.request_id,
        result: {
          ok: true,
          action: 'file.search',
          results: [{ name: 'image.png', path: 'C:\\Users\\maxob\\Desktop\\image.png' }],
        },
      },
    }) + '\n');

    await waitFor(() => runtime.events.some((event) => event.type === 'needs_input' && event.task_id === 'demo-task'));
    const plan = runtime.events.find((event) => event.type === 'plan_draft' && event.task_id === 'demo-task');
    assert(plan, 'expected plan_draft event');
    assert(plan.payload.plan.some((step) => step.action === 'ask_user'), 'expected ask_user plan step');

    runtime.child.stdin.write(JSON.stringify({
      type: 'task_action',
      id: 'choice-1',
      task_id: 'demo-task',
      payload: {
        action: 'user_choice',
        index: 0,
        choice: 'Create on desktop',
      },
    }) + '\n');

    await waitFor(() => runtime.events.some((event) => event.type === 'tool_request' && event.payload.request_id === 'demo-task:create_images_folder'));
    const createFolderRequest = runtime.events.find((event) => event.payload && event.payload.request_id === 'demo-task:create_images_folder');
    assert.strictEqual(createFolderRequest.payload.action, 'file.create_folder');

    runtime.child.stdin.write('[]\n');
    await waitFor(() => runtime.events.some((event) => event.type === 'error' && /message must be/.test(event.payload.error)));

    console.log('[testAgentRuntimeProtocol] protocol smoke passed');
  } finally {
    runtime.rl.close();
    runtime.child.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
