const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Jarvis Desktop currently packages the local wake word runtime only for Windows x64.');
}

const destinationDirectory = path.join(__dirname, '..', 'build', 'node-runtime');
const destination = path.join(destinationDirectory, 'node.exe');
fs.mkdirSync(destinationDirectory, { recursive: true });
fs.copyFileSync(process.execPath, destination);

const runtimeDirectory = path.dirname(process.execPath);
const licenseSource = path.join(runtimeDirectory, 'LICENSE');
if (fs.existsSync(licenseSource)) fs.copyFileSync(licenseSource, path.join(destinationDirectory, 'LICENSE'));

console.log('Wake word Node runtime is ready for packaging.');
