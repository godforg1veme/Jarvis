// Package the same action implementations used by Mini App, without a second
// fork of confirmation, revision or unknown-result handling.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'renderer', 'workspace', 'shared');
const names = require('./desktopWorkspaceModules.json');
if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length
  || names.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9_-]+\.(js|css)$/.test(name))) {
  throw new Error('Invalid Desktop workspace asset catalog.');
}
function prepareDesktopWorkspace() {
  fs.mkdirSync(output, { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(root, 'mini-app', 'src', name), path.join(output, name));
}
if (require.main === module) { prepareDesktopWorkspace(); console.log('Desktop personal workspace modules prepared.'); }
module.exports = { prepareDesktopWorkspace, names };
