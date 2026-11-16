// Build the actual web dashboard components; never maintain a visual replica.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const vite = path.join(root, 'ops-ui/node_modules/vite/bin/vite.js');
if (!fs.existsSync(vite)) throw new Error('Run npm run setup to install Operations UI build dependencies.');
const result = spawnSync(process.execPath, [vite, 'build', '--config', 'desktop.vite.config.ts'], { cwd: path.join(root, 'ops-ui'), stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const output = path.join(root, 'renderer/orbital/assets');
fs.mkdirSync(output, { recursive: true });
for (const name of ['milky-way-gaia-4k.webp', 'milky-way-gaia-8k.webp', 'SKY-CREDITS.md']) {
  fs.copyFileSync(path.join(root, 'ops-ui/public/assets', name), path.join(output, name));
}
const assets = ['scene.js', 'scene.css', 'assets/milky-way-gaia-4k.webp', 'assets/milky-way-gaia-8k.webp', 'assets/SKY-CREDITS.md'];
const hashes = Object.fromEntries(assets.map((name) => [name, createHash('sha256').update(fs.readFileSync(path.join(root, 'renderer/orbital', name))).digest('hex')]));
// Commit the accepted output digests; release inventory checks the installed
// build without needing Vite or node_modules on a production source checkout.
fs.writeFileSync(path.join(root, 'scripts/desktopSceneAssets.json'), JSON.stringify(hashes, null, 2) + '\n');
