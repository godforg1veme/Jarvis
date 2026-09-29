const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli) || path.basename(npmCli) !== 'npm-cli.js') {
  console.error('Run this installer with npm run setup.');
  process.exit(1);
}

// ffi-napi's direct-addon prebuild probe crashes on this Windows Node runtime.
// Its supported package-name flag skips that probe, not dependency scripts.
// Verify the public native entry points separately after the locked install.
const environment = { ...process.env };
if (process.platform === 'win32') environment.FFI_NAPI = '1';
const install = spawnSync(process.execPath, [npmCli, 'ci'], {
  cwd: root, env: environment, stdio: 'inherit', windowsHide: true,
});
if (install.error || install.status !== 0) {
  console.error('Locked dependency installation failed.');
  process.exit(install.status || 1);
}

const verification = spawnSync(process.execPath, ['-e', `
  const fs = require('node:fs');
  require('ref-napi');
  require('ffi-napi');
  require('vosk');
  if (!fs.existsSync(require('electron'))) throw new Error('Electron executable is missing');
  console.log('Native modules and Electron are ready.');
`], { cwd: root, stdio: 'inherit', windowsHide: true });
if (verification.error || verification.status !== 0) {
  console.error('Dependency verification failed.');
  process.exit(verification.status || 1);
}
