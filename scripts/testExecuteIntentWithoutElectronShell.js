const assert = require('assert');

const { executeIntent } = require('../actions/executeIntent');

async function main() {
  const result = await executeIntent({
    ok: true,
    action: 'launch_app',
    appId: 'notepad',
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Electron shell/i);
  console.log('testExecuteIntentWithoutElectronShell: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
