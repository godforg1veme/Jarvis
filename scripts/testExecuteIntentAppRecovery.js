const assert = require('assert');
const { executeIntent } = require('../actions/executeIntent');

(async () => {
  const calls = [];
  const result = await executeIntent({
    ok: true,
    action: 'recover_app',
    command: 'открой обсидиан',
    appQuery: 'Obsidian',
  }, {
    startAppRecovery: async (query, options) => {
      calls.push({ query, options });
      return {
        recoveryId: 'recovery-1',
        state: 'awaiting_confirmation',
        candidates: [{ candidateId: 'candidate-1', displayName: 'Obsidian' }],
      };
    },
  });
  assert.strictEqual(result.type, 'app_recovery');
  assert.strictEqual(result.recovery.state, 'awaiting_confirmation');
  assert.deepStrictEqual(calls[0], {
    query: 'открой обсидиан',
    options: { inputChannel: 'voice', normalizedQuery: 'Obsidian' },
  });
  console.log('testExecuteIntentAppRecovery: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
