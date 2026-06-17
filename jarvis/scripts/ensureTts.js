const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensurePiperTts } = require('./ensurePiperTts');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_SETTINGS = {
  provider: 'silero',
  fallbackProvider: 'piper',
  model: 'v5_ru',
  modelDir: path.join('voices', 'silero'),
  modelUrl: 'https://models.silero.ai/models/tts/ru/v5_ru.pt',
};

function loadSettings(fsApi, projectRoot) {
  try {
    return JSON.parse(fsApi.readFileSync(path.join(projectRoot, 'data', 'tts-settings.json'), 'utf-8'));
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

function quotePythonString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildDownloadCode(url, outputFile) {
  return `import torch, pathlib; torch.hub.download_url_to_file('${quotePythonString(url)}', r'${outputFile}')`;
}

function ensureSileroTts(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const fsApi = options.fs || fs;
  const run = options.run || ((command, args, runOptions = {}) => runCommand(command, args, {
    cwd: projectRoot,
    ...runOptions,
  }));
  const log = options.log || console.log;
  const settings = { ...DEFAULT_SETTINGS, ...loadSettings(fsApi, projectRoot) };

  const model = String(settings.model || DEFAULT_SETTINGS.model).trim();
  const modelDir = resolveProjectPath(projectRoot, settings.modelDir || DEFAULT_SETTINGS.modelDir);
  const modelPath = resolveProjectPath(projectRoot, settings.modelPath || path.join(modelDir, `${model}.pt`));
  const modelUrl = String(settings.modelUrl || DEFAULT_SETTINGS.modelUrl);

  let installed = false;
  let downloaded = false;

  log('[tts] Checking Silero TTS...');
  const torchCheck = run('py', ['-c', 'import torch, scipy'], { stdio: 'ignore' });
  if (torchCheck.status !== 0) {
    log('[tts] PyTorch/SciPy are not available. Installing torch and scipy...');
    ensureCommandOk(
      run('py', ['-m', 'pip', 'install', '--user', 'torch', 'scipy']),
      'Failed to install torch/scipy.'
    );
    installed = true;
  }

  if (!fsApi.existsSync(modelPath)) {
    log(`[tts] Downloading Silero model: ${model}`);
    if (!fsApi.existsSync(modelDir)) fsApi.mkdirSync(modelDir, { recursive: true });
    ensureCommandOk(
      run('py', ['-c', buildDownloadCode(modelUrl, modelPath)]),
      `Failed to download Silero model: ${model}.`
    );
    downloaded = true;
  }

  if (!fsApi.existsSync(modelPath)) {
    throw new Error(`Silero model is missing after setup: ${modelPath}`);
  }

  log(`[tts] Silero ready: ${model}`);
  return {
    ok: true,
    installed,
    downloaded,
    model,
    modelPath,
  };
}

function ensureTts(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const fsApi = options.fs || fs;
  const run = options.run;
  const log = options.log || console.log;
  const settings = { ...DEFAULT_SETTINGS, ...loadSettings(fsApi, projectRoot) };
  const provider = String(settings.provider || DEFAULT_SETTINGS.provider);
  const fallbackProvider = settings.fallbackProvider === false ? false : String(settings.fallbackProvider || '');

  let silero = null;
  let piper = null;

  if (provider === 'silero' || fallbackProvider === 'silero') {
    silero = ensureSileroTts({ projectRoot, fs: fsApi, run, log });
  }

  if (provider === 'piper' || fallbackProvider === 'piper') {
    piper = ensurePiperTts({ projectRoot, fs: fsApi, run, log });
  }

  return {
    ok: true,
    provider,
    fallbackProvider,
    silero,
    piper,
  };
}

function main() {
  ensureTts();
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
  ensureSileroTts,
  ensureTts,
  buildDownloadCode,
};
