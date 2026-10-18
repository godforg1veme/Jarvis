import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') throw new Error('Invalid build output');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'vendor'), { recursive: true });
for (const name of ['index.html']) await copyFile(path.join(root, name), path.join(dist, name));
for (const name of ['app.js', 'api.js', 'admin.js', 'core.js', 'style.css']) {
  let source = await readFile(path.join(root, 'src', name), 'utf8');
  if (name === 'core.js') source = source.replace("from 'three'", "from './vendor/three.module.js'");
  await writeFile(path.join(dist, name), source);
}
for (const name of ['three.module.js', 'three.core.js']) await copyFile(path.join(root, 'node_modules/three/build', name), path.join(dist, 'vendor', name));
const room = await readFile(path.join(root, 'node_modules/three/examples/jsm/environments/RoomEnvironment.js'), 'utf8');
await writeFile(path.join(dist, 'vendor/RoomEnvironment.js'), room.replace("from 'three'", "from './three.module.js'"));
await copyFile(path.join(root, 'node_modules/three/LICENSE'), path.join(dist, 'vendor/THREE-LICENSE.txt'));
console.log('Mini App built: allowlisted local assets only.');
