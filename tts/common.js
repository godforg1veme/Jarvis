const path = require('path');

function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'speech';
}

function resolveProjectPath(projectRoot, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.join(projectRoot, raw);
}

function ensureDir(fsApi, dir) {
  if (!fsApi.existsSync(dir)) fsApi.mkdirSync(dir, { recursive: true });
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let stdout = '';

    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    }

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(`${label} failed: ${detail}`));
    });
  });
}

function encodePowerShellCommand(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function createPlayWavArgs(filePath) {
  const pathBase64 = Buffer.from(filePath, 'utf8').toString('base64');
  const command = [
    `$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathBase64}'))`,
    '$player = New-Object System.Media.SoundPlayer $path',
    '$player.Load()',
    '$player.PlaySync()',
  ].join('; ');

  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShellCommand(command),
  ];
}

async function playWav(spawn, projectRoot, filePath) {
  const child = spawn('powershell.exe', createPlayWavArgs(filePath), {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  await waitForExit(child, 'WAV playback');
}

module.exports = {
  createPlayWavArgs,
  ensureDir,
  playWav,
  resolveProjectPath,
  sanitizeFilePart,
  waitForExit,
};
