const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'stt_runtime');
const VENV_DIR = path.join(RUNTIME_DIR, '.venv');
const REQUIREMENTS = path.join(RUNTIME_DIR, 'requirements.txt');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  return result.status === 0;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    ...options,
  });

  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function parsePythonVersion(output) {
  const match = String(output || '').match(/Python\s+(\d+)\.(\d+)/i);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function isSupportedPython(version) {
  if (!version || version.major !== 3) return false;
  return version.minor >= 10 && version.minor <= 12;
}

function candidateVersion(candidate) {
  return parsePythonVersion(capture(candidate.command, [...candidate.args, '--version']));
}

function findPython() {
  const candidates = [];

  if (process.env.JARVIS_STT_PYTHON) {
    candidates.push({ command: process.env.JARVIS_STT_PYTHON, args: [] });
  }

  candidates.push(
    { command: 'py', args: ['-3.12'] },
    { command: 'py', args: ['-3.11'] },
    { command: 'py', args: ['-3.10'] },
    { command: 'python', args: [] },
    { command: 'python3', args: [] },
  );

  for (const candidate of candidates) {
    if (isSupportedPython(candidateVersion(candidate))) {
      return candidate;
    }
  }

  if (capture('uv', ['--version'])) {
    const existingUvPython = capture('uv', ['python', 'find', '3.12']);
    if (existingUvPython) {
      const candidate = { command: existingUvPython, args: [] };
      if (isSupportedPython(candidateVersion(candidate))) {
        return candidate;
      }
    }

    console.log('[ensureStt] Python 3.10-3.12 not found. Installing Python 3.12 with uv...');
    if (run('uv', ['python', 'install', '3.12'])) {
      const pythonPath = capture('uv', ['python', 'find', '3.12']);
      if (pythonPath) {
        const candidate = { command: pythonPath, args: [] };
        if (isSupportedPython(candidateVersion(candidate))) {
          return candidate;
        }
      }
    }
  }

  return null;
}

function venvPythonPath() {
  return process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python');
}

function main() {
  if (!fs.existsSync(REQUIREMENTS)) {
    console.error(`[ensureStt] Missing ${REQUIREMENTS}`);
    process.exit(1);
  }

  const python = findPython();
  if (!python) {
    console.error('[ensureStt] Python 3.10-3.12 not found. Install Python 3.12 or set JARVIS_STT_PYTHON.');
    process.exit(1);
  }

  if (!fs.existsSync(venvPythonPath())) {
    console.log(`[ensureStt] Creating venv at ${VENV_DIR}`);
    if (!run(python.command, [...python.args, '-m', 'venv', VENV_DIR])) {
      console.error('[ensureStt] Failed to create venv.');
      process.exit(1);
    }
  }

  const venvPython = venvPythonPath();
  console.log('[ensureStt] Upgrading pip');
  if (!run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])) {
    process.exit(1);
  }

  console.log('[ensureStt] Installing faster-whisper requirements');
  if (!run(venvPython, ['-m', 'pip', 'install', '-r', REQUIREMENTS])) {
    process.exit(1);
  }

  console.log('[ensureStt] Verifying Python imports');
  if (!run(venvPython, ['-c', 'import faster_whisper, numpy; print("faster-whisper imports OK")'])) {
    process.exit(1);
  }

  console.log('[ensureStt] STT runtime is ready.');
  console.log('[ensureStt] If CUDA DLL errors appear at runtime, install CUDA 12/cuDNN 9 libraries or use device=\"cpu\" in data/stt-settings.json.');
}

main();
