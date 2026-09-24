const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'data', 'tts-settings.json');
const DEFAULT_VOICE = 'ru_RU-irina-medium';

function loadSettings(fsApi, projectRoot) {
  const settingsPath = path.join(projectRoot, 'data', 'tts-settings.json');
  try {
    return JSON.parse(fsApi.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}

function resolveProjectPath(projectRoot, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.join(projectRoot, raw);
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: true,
  });
}

function ensureCommandOk(result, message) {
  if (result.status === 0) return;
  const detail = result.error ? ` ${result.error.message}` : '';
  throw new Error(`${message}${detail}`);
}

function ensurePiperTts(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const fsApi = options.fs || fs;
  const run = options.run || ((command, args, runOptions = {}) => runCommand(command, args, {
    cwd: projectRoot,
    ...runOptions,
  }));
  const log = options.log || console.log;
  const settings = {
    voice: DEFAULT_VOICE,
    voiceDir: path.join('voices', 'piper'),
    ...loadSettings(fsApi, projectRoot),
  };

  const voice = String(settings.voice || DEFAULT_VOICE).trim();
  const voiceDir = resolveProjectPath(projectRoot, settings.voiceDir || path.join('voices', 'piper'));
  const modelPath = resolveProjectPath(projectRoot, settings.modelPath || path.join(voiceDir, `${voice}.onnx`));
  const configPath = resolveProjectPath(projectRoot, settings.configPath || `${modelPath}.json`);

  let installed = false;
  let downloaded = false;

  log('[tts] Checking Piper TTS...');
  const piperCheck = run('py', ['-m', 'piper', '--help'], { stdio: 'ignore' });
  if (piperCheck.status !== 0) {
    log('[tts] Piper is not available. Installing piper-tts...');
    ensureCommandOk(
      run('py', ['-m', 'pip', 'install', '--user', 'piper-tts']),
      'Failed to install piper-tts.'
    );
    installed = true;
  }

  const hasVoice = fsApi.existsSync(modelPath) && fsApi.existsSync(configPath);
  if (!hasVoice) {
    log(`[tts] Downloading Piper voice: ${voice}`);
    if (!fsApi.existsSync(voiceDir)) fsApi.mkdirSync(voiceDir, { recursive: true });
    ensureCommandOk(
      run('py', ['-m', 'piper.download_voices', '--download-dir', voiceDir, voice]),
      `Failed to download Piper voice: ${voice}.`
    );
    downloaded = true;
  }

  if (!fsApi.existsSync(modelPath) || !fsApi.existsSync(configPath)) {
    throw new Error(`Piper voice files are missing after setup: ${modelPath}, ${configPath}`);
  }

  log(`[tts] Piper ready: ${voice}`);
  return {
    ok: true,
    installed,
    downloaded,
    voice,
    modelPath,
    configPath,
  };
}

function main() {
  ensurePiperTts();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[tts] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  SETTINGS_PATH,
  ensurePiperTts,
};
