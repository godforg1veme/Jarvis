const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'cloud', 'cloudPreload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'cloud', 'desktopCloudClient.js'), 'utf8');

for (const method of ['getMissionControl', 'getLifeTimeline', 'createLifeProject', 'getLifeProjectContext', 'recordLifeFeedback', 'confirmLifeProposal', 'dismissLifeProposal', 'updateLifeCommitment']) {
  assert.match(preload, new RegExp(`\\b${method}\\b`), `preload misses ${method}`);
}
for (const channel of ['life:mission-control', 'life:timeline', 'life:project-create', 'life:project-update', 'life:project-context', 'life:feedback', 'life:proposal-confirm', 'life:proposal-dismiss', 'life:commitment-update']) {
  assert.match(main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `main misses ${channel}`);
}
assert.match(main, /isTrustedMainRenderer\(event\)/);
assert.match(main, /const lifeId = \(value\) => \/\^\[a-f0-9-\]\{36\}\$\/i/);
assert.doesNotMatch(preload, /Authorization|Bearer|serverUrl.*life/i);
assert.match(client, /\/v1\/desktop\/life\/mission-control/);
assert.match(client, /encodeURIComponent/);
console.log('[test] Life OS IPC boundary OK');
