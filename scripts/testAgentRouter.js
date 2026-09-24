const assert = require('assert');

const {
  parseAgentCommand,
  shouldEscalateResult,
  shouldUseDesktopAgent,
  stripAgentPrefix,
} = require('../agents/agentRouter');
const { parseIntent } = require('../voice/intentParser');
const { executeIntent } = require('../actions/executeIntent');

async function run() {
  assert.strictEqual(stripAgentPrefix('/agent move files'), 'move files');
  assert.strictEqual(stripAgentPrefix('agent, find files'), 'find files');
  assert.strictEqual(stripAgentPrefix('Jarvis organize files'), 'files');

  assert.strictEqual(shouldUseDesktopAgent('/agent move files'), true);
  assert.strictEqual(shouldUseDesktopAgent('find all png on desktop and move to Images'), true);
  assert.strictEqual(shouldUseDesktopAgent('layout windows vscode left and firefox right'), true);
  assert.strictEqual(shouldUseDesktopAgent('open chrome'), false);

  assert.deepStrictEqual(parseAgentCommand('/agent move files'), {
    action: 'desktop_agent',
    command: 'move files',
    explicit: true,
  });

  assert.strictEqual(shouldEscalateResult({ needsSelection: true }), true);
  assert.strictEqual(shouldEscalateResult({ ok: true }), false);

  const voiceIntent = parseIntent('agent find all png on desktop and move to Images');
  assert.strictEqual(voiceIntent.ok, true);
  assert.strictEqual(voiceIntent.action, 'desktop_agent');
  assert(voiceIntent.command.includes('png'));

  let startedCommand = '';
  const executed = await executeIntent(voiceIntent, {
    startAgentTask: async (command) => {
      startedCommand = command;
      return { ok: true, type: 'agent', message: 'started' };
    },
  });
  assert.strictEqual(executed.ok, true);
  assert(startedCommand.includes('png'));

  console.log('[testAgentRouter] agent router tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
