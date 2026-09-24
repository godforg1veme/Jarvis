const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'cloud', 'cloudPreload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'cloud', 'desktopCloudClient.js'), 'utf8');
const ipcSource = fs.readFileSync(path.join(root, 'cloud', 'lifeOsIpc.js'), 'utf8');
const { registerLifeOsIpc } = require('../cloud/lifeOsIpc');

for (const method of ['getMissionControl', 'getLifeTimeline', 'createLifeProject', 'getLifeProjectContext', 'recordLifeFeedback', 'confirmLifeProposal', 'dismissLifeProposal', 'updateLifeCommitment', 'getLifeMode', 'setLifeMode', 'getLifePreferences', 'getLifePeople', 'createLifeRecoveryPlan', 'getLifeSources', 'syncLifeSource']) {
  assert.match(preload, new RegExp(`\\b${method}\\b`), `preload misses ${method}`);
}
for (const channel of ['life:mission-control', 'life:timeline', 'life:project-create', 'life:project-update', 'life:project-context', 'life:feedback', 'life:proposal-confirm', 'life:proposal-dismiss', 'life:commitment-update', 'life:mode-set', 'life:preferences', 'life:people', 'life:recovery-create', 'life:sources']) {
  assert.match(ipcSource, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `IPC module misses ${channel}`);
}
assert.match(main, /registerLifeOsIpc/);
assert.doesNotMatch(main, /ipcMain\.handle\('life:/);
assert.match(ipcSource, /isTrustedRenderer\(event\)/);
assert.match(ipcSource, /UUID_PATTERN/);
assert.doesNotMatch(preload, /Authorization|Bearer|serverUrl.*life/i);
assert.match(client, /\/v1\/desktop\/life\/mission-control/);
assert.match(client, /encodeURIComponent/);

const handlers = new Map();
const calls = [];
registerLifeOsIpc({
  ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
  isTrustedRenderer: (event) => event?.trusted === true,
  getClient: () => ({
    setLifeMode(input) { calls.push(['mode', input]); return { ok: true }; },
    createLifeSource(input) { calls.push(['source', input]); return { ok: true }; },
  }),
});

(async () => {
  assert.equal((await handlers.get('life:mode-set')({ trusted: false }, { mode: 'focus' })).code, 'LIFE_ACCESS_DENIED');
  assert.equal((await handlers.get('life:mode-set')({ trusted: true }, { mode: 'administrator' })).code, 'LIFE_INVALID_INPUT');
  await handlers.get('life:mode-set')({ trusted: true }, { mode: 'focus', revision: 2, ownerId: 'forbidden' });
  await handlers.get('life:source-create')({ trusted: true }, { adapterType: 'email', displayName: ' Mail ', enabled: true, configurationMetadata: { folder: 'priority' }, credentials: 'forbidden' });
  assert.deepEqual(calls[0], ['mode', { mode: 'focus', revision: 2 }]);
  assert.deepEqual(calls[1], ['source', { adapterType: 'email', displayName: 'Mail', enabled: true, selectedScope: {}, privacyPolicyVersion: 1, configurationMetadata: { folder: 'priority' } }]);
  console.log('[test] Life OS IPC boundary OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
