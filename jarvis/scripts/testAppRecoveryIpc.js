const assert = require('assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

for (const channel of ['app-recovery-select', 'app-recovery-confirm', 'app-recovery-cancel', 'app-recovery-details']) {
  assert(main.includes(`ipcMain.handle('${channel}'`));
}
assert(main.includes('isTrustedMainRenderer(event)'));
assert(main.includes("requireOpaqueId(recoveryId, 'recovery')"));
assert(main.includes("requireOpaqueId(candidateId, 'candidate')"));
assert(main.includes("return await launchRegisteredSelection(request && request.candidateId)"));
assert(!preload.includes("ipcRenderer.invoke('launch-selected-app', app)"));
assert(preload.includes("ipcRenderer.invoke('launch-selected-app', { candidateId })"));
assert(preload.includes("onAppRecoveryState"));

console.log('testAppRecoveryIpc: ok');
