const assert = require('assert');
const { buildGetForegroundWindowScript, buildSendCtrlCScript } = require('../tools/windowsSelectionCopy');

function testBuildsScriptWithTargetWindowRestore() {
  const script = buildSendCtrlCScript(12345);

  assert.match(script, /SetForegroundWindow/);
  assert.match(script, /\[IntPtr\]12345/);
  assert.match(script, /SendWait\('\^c'\)/);
}

function testBuildsScriptWithoutTargetWindowRestore() {
  const script = buildSendCtrlCScript(null);

  assert.doesNotMatch(script, /\[IntPtr\]null/);
  assert.match(script, /SendWait\('\^c'\)/);
}

function testBuildsGetForegroundWindowScript() {
  const script = buildGetForegroundWindowScript();

  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /ToInt64/);
}

function main() {
  testBuildsGetForegroundWindowScript();
  testBuildsScriptWithTargetWindowRestore();
  testBuildsScriptWithoutTargetWindowRestore();
  console.log('testWindowsSelectionCopy: ok');
}

main();
