const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'data', 'stt-settings.json');
const STT_RUNTIME_DIR = path.join(ROOT, 'stt_runtime');
const STT_VENV_DIR = path.join(STT_RUNTIME_DIR, '.venv');

const DEFAULT_SETTINGS = {
  provider: 'faster-whisper',
  readyTimeoutMs: 10000,
  fasterWhisper: {
    model: 'large-v3',
    device: 'cuda',
    computeType: 'int8_float16',
    language: 'ru',
    beamSize: 5,
    vadFilter: true,
    minSpeechMs: 600,
    silenceMs: 900,
    maxSegmentMs: 10000,
    startRms: 0.022,
    continueRms: 0.012,
    preRollMs: 300,
    initialPrompt: '',
    hotwords: '',
  },
  vosk: {
    modelDir: path.join('models', 'vosk-model-small-ru-0.22'),
  },
};

function mergeSettings(base, override) {
  const result = { ...base, ...(override || {}) };
  result.fasterWhisper = {
    ...base.fasterWhisper,
    ...((override && override.fasterWhisper) || {}),
  };
  result.vosk = {
    ...base.vosk,
    ...((override && override.vosk) || {}),
  };
  return result;
}

function getSttSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return mergeSettings(DEFAULT_SETTINGS, null);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return mergeSettings(DEFAULT_SETTINGS, parsed);
  } catch (error) {
    throw new Error(`Failed to read STT settings from ${SETTINGS_PATH}: ${error.message}`);
  }
}

function sttSettingsPath() {
  return SETTINGS_PATH;
}

function sttRuntimeDir() {
  return STT_RUNTIME_DIR;
}

function defaultSttPythonPath() {
  return process.platform === 'win32'
    ? path.join(STT_VENV_DIR, 'Scripts', 'python.exe')
    : path.join(STT_VENV_DIR, 'bin', 'python');
}

function resolveSttPythonPath(settings = getSttSettings()) {
  const configured = settings.fasterWhisper && settings.fasterWhisper.pythonPath;
  if (configured) return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);

  const venvPython = defaultSttPythonPath();
  if (fs.existsSync(venvPython)) return venvPython;

  return process.env.JARVIS_STT_PYTHON || 'python';
}

module.exports = {
  DEFAULT_SETTINGS,
  getSttSettings,
  sttSettingsPath,
  sttRuntimeDir,
  defaultSttPythonPath,
  resolveSttPythonPath,
};
