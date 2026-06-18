const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'agent_runtime');
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

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function findPython() {
  const candidates = [
    { command: 'py', args: ['-3.11'] },
    { command: 'py', args: ['-3'] },
    { command: 'python', args: [] },
    { command: 'python3', args: [] },
  ];

  for (const candidate of candidates) {
    const version = capture(candidate.command, [...candidate.args, '--version']);
    const match = version.match(/Python\s+(\d+)\.(\d+)/i);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major > 3 || (major === 3 && minor >= 11)) {
      return candidate;
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
    console.error(`[ensureAgentRuntime] Missing ${REQUIREMENTS}`);
    process.exit(1);
  }

  const python = findPython();
  if (!python) {
    console.error('[ensureAgentRuntime] Python 3.11+ not found. Install Python 3.11 or newer and retry.');
    process.exit(1);
  }

  if (!fs.existsSync(venvPythonPath())) {
    console.log(`[ensureAgentRuntime] Creating venv at ${VENV_DIR}`);
    if (!run(python.command, [...python.args, '-m', 'venv', VENV_DIR])) {
      console.error('[ensureAgentRuntime] Failed to create venv.');
      process.exit(1);
    }
  }

  const venvPython = venvPythonPath();
  console.log('[ensureAgentRuntime] Upgrading pip');
  if (!run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])) {
    process.exit(1);
  }

  console.log('[ensureAgentRuntime] Installing requirements');
  if (!run(venvPython, ['-m', 'pip', 'install', '-r', REQUIREMENTS])) {
    process.exit(1);
  }

  console.log('[ensureAgentRuntime] Agent runtime is ready.');
}

main();
