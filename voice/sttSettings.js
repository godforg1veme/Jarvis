const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'data', 'stt-settings.json');
const PROFILES_PATH = path.join(ROOT, 'data', 'stt-profiles.json');
const PREVIEW_SETTINGS_PATH = path.join(ROOT, 'data', 'stt-settings.preview.json');
const STT_RUNTIME_DIR = path.join(ROOT, 'stt_runtime');
const STT_VENV_DIR = path.join(STT_RUNTIME_DIR, '.venv');

const PERFORMANCE_PROFILES = Object.freeze({
  quality: Object.freeze({ beamSize: 5, vadFilter: true }),
  efficient: Object.freeze({ beamSize: 1, vadFilter: false }),
});

const DEFAULT_SETTINGS = {
  provider: 'faster-whisper',
  readyTimeoutMs: 10000,
  capture: {
    deviceId: '',
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
  },
  advisor: {
    mode: 'problems-only',
    minSamples: 20,
    cooldownMs: 1800000,
    allowAudio: false,
    model: 'gemini-2.5-flash-lite',
  },
  fasterWhisper: {
    model: 'large-v3',
    device: 'cuda',
    computeType: 'int8_float16',
    language: 'ru',
    performanceProfile: 'quality',
    beamSize: 5,
    vadFilter: true,
    minSpeechMs: 600,
    silenceMs: 900,
    maxSegmentMs: 10000,
    startRms: 0.022,
    continueRms: 0.012,
    preRollMs: 300,
    maxNoSpeechProb: 0.6,
    minAvgLogProb: -1.0,
    initialPrompt: '',
    hotwords: '',
  },
  vosk: {
    modelDir: path.join('models', 'vosk-model-small-ru-0.22'),
  },
};

const SETTINGS_BOUNDS = Object.freeze({
  readyTimeoutMs: [1000, 300000],
  minSpeechMs: [100, 5000],
  silenceMs: [200, 5000],
  maxSegmentMs: [1000, 30000],
  startRms: [0.001, 0.5],
  continueRms: [0.0005, 0.5],
  preRollMs: [0, 2000],
  maxNoSpeechProb: [0, 1],
  minAvgLogProb: [-5, 0],
  beamSize: [1, 10],
  minSamples: [5, 200],
  cooldownMs: [60000, 86400000],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertBoundedNumber(value, name, [min, max], integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean.`);
}

function assertString(value, name, maxLength, pattern = null) {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${name} must be a string of at most ${maxLength} characters.`);
  }
  if (pattern && value && !pattern.test(value)) throw new Error(`${name} has an invalid format.`);
}

function resolvePerformanceProfile(settings = {}) {
  const profile = String(settings.performanceProfile || 'quality').trim().toLowerCase();
  if (PERFORMANCE_PROFILES[profile]) {
    return {
      ...settings,
      performanceProfile: profile,
      ...PERFORMANCE_PROFILES[profile],
    };
  }
  if (profile !== 'custom') {
    throw new Error(
      `Unknown fasterWhisper.performanceProfile: ${profile}. Expected quality, efficient, or custom.`,
    );
  }

  const beamSize = Number(settings.beamSize);
  if (!Number.isInteger(beamSize) || beamSize < 1) {
    throw new Error('fasterWhisper.beamSize must be an integer of at least 1 in custom mode.');
  }
  if (typeof settings.vadFilter !== 'boolean') {
    throw new Error('fasterWhisper.vadFilter must be boolean in custom mode.');
  }
  return { ...settings, performanceProfile: profile, beamSize, vadFilter: settings.vadFilter };
}

function mergeSettings(base, override) {
  const result = { ...base, ...(override || {}) };
  result.capture = {
    ...(base.capture || DEFAULT_SETTINGS.capture),
    ...((override && override.capture) || {}),
  };
  result.advisor = {
    ...(base.advisor || DEFAULT_SETTINGS.advisor),
    ...((override && override.advisor) || {}),
  };
  result.fasterWhisper = resolvePerformanceProfile({
    ...base.fasterWhisper,
    ...((override && override.fasterWhisper) || {}),
  });
  result.vosk = {
    ...base.vosk,
    ...((override && override.vosk) || {}),
  };
  return result;
}

function validateSttSettings(settings = {}) {
  const result = mergeSettings(DEFAULT_SETTINGS, settings);
  if (!['faster-whisper', 'faster_whisper', 'vosk'].includes(String(result.provider).toLowerCase())) {
    throw new Error(`Unsupported STT provider: ${result.provider}.`);
  }

  assertBoundedNumber(result.readyTimeoutMs, 'readyTimeoutMs', SETTINGS_BOUNDS.readyTimeoutMs, true);

  const fw = result.fasterWhisper;
  assertString(fw.model, 'fasterWhisper.model', 100);
  assertString(fw.device, 'fasterWhisper.device', 20, /^(cuda|cpu|auto)$/u);
  assertString(fw.computeType, 'fasterWhisper.computeType', 40, /^[a-z0-9_]+$/u);
  assertString(fw.language, 'fasterWhisper.language', 12, /^[a-z-]+$/iu);
  assertBoundedNumber(fw.minSpeechMs, 'fasterWhisper.minSpeechMs', SETTINGS_BOUNDS.minSpeechMs, true);
  assertBoundedNumber(fw.silenceMs, 'fasterWhisper.silenceMs', SETTINGS_BOUNDS.silenceMs, true);
  assertBoundedNumber(fw.maxSegmentMs, 'fasterWhisper.maxSegmentMs', SETTINGS_BOUNDS.maxSegmentMs, true);
  assertBoundedNumber(fw.startRms, 'fasterWhisper.startRms', SETTINGS_BOUNDS.startRms);
  assertBoundedNumber(fw.continueRms, 'fasterWhisper.continueRms', SETTINGS_BOUNDS.continueRms);
  assertBoundedNumber(fw.preRollMs, 'fasterWhisper.preRollMs', SETTINGS_BOUNDS.preRollMs, true);
  assertBoundedNumber(fw.maxNoSpeechProb, 'fasterWhisper.maxNoSpeechProb', SETTINGS_BOUNDS.maxNoSpeechProb);
  assertBoundedNumber(fw.minAvgLogProb, 'fasterWhisper.minAvgLogProb', SETTINGS_BOUNDS.minAvgLogProb);
  assertBoundedNumber(fw.beamSize, 'fasterWhisper.beamSize', SETTINGS_BOUNDS.beamSize, true);
  assertBoolean(fw.vadFilter, 'fasterWhisper.vadFilter');
  assertString(fw.initialPrompt, 'fasterWhisper.initialPrompt', 2000);
  assertString(fw.hotwords, 'fasterWhisper.hotwords', 2000);
  if (fw.pythonPath !== undefined) assertString(fw.pythonPath, 'fasterWhisper.pythonPath', 500);

  const capture = result.capture;
  assertString(capture.deviceId, 'capture.deviceId', 512);
  if (capture.channelCount !== 1) throw new Error('capture.channelCount must be 1.');
  assertBoolean(capture.echoCancellation, 'capture.echoCancellation');
  assertBoolean(capture.noiseSuppression, 'capture.noiseSuppression');
  assertBoolean(capture.autoGainControl, 'capture.autoGainControl');

  const advisor = result.advisor;
  assertString(advisor.mode, 'advisor.mode', 30, /^(off|problems-only|manual)$/u);
  assertBoundedNumber(advisor.minSamples, 'advisor.minSamples', SETTINGS_BOUNDS.minSamples, true);
  assertBoundedNumber(advisor.cooldownMs, 'advisor.cooldownMs', SETTINGS_BOUNDS.cooldownMs, true);
  assertBoolean(advisor.allowAudio, 'advisor.allowAudio');
  assertString(advisor.model, 'advisor.model', 100, /^[a-z0-9._-]+$/iu);

  // The API key is intentionally not part of the persisted or renderer-facing settings.
  delete result.apiKey;
  delete result.geminiApiKey;
  return result;
}

function getSttSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return validateSttSettings(DEFAULT_SETTINGS);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return validateSttSettings(parsed);
  } catch (error) {
    throw new Error(`Failed to read STT settings from ${SETTINGS_PATH}: ${error.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function saveSttSettings(settings, filePath = SETTINGS_PATH) {
  const validated = validateSttSettings(settings);
  writeJsonAtomic(filePath, validated);
  return validated;
}

function sttProfilesPath() {
  return PROFILES_PATH;
}

function sttPreviewSettingsPath() {
  return PREVIEW_SETTINGS_PATH;
}

function readProfiles() {
  if (!fs.existsSync(PROFILES_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map((profile) => ({
      id: String(profile.id || ''),
      name: String(profile.name || profile.id || 'Без названия'),
      deviceId: String(profile.deviceId || ''),
      settings: validateSttSettings(profile.settings || {}),
      source: ['manual', 'local-calibration', 'gemini'].includes(profile.source) ? profile.source : 'manual',
      createdAt: String(profile.createdAt || new Date(0).toISOString()),
    })).filter((profile) => /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(profile.id));
  } catch (error) {
    console.warn(`[sttSettings] Failed to read profiles: ${error.message}`);
    return [];
  }
}

function getSttProfiles() {
  return readProfiles().map(clone);
}

function profileIdFromName(name) {
  const normalized = String(name || 'Мой профиль')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/[а-яё]/giu, (char) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[char] || ''))
    .slice(0, 56);
  return normalized || `profile-${Date.now().toString(36)}`;
}

function saveSttProfile({ id, name, deviceId = '', settings, source = 'manual' }) {
  const validatedSettings = validateSttSettings(settings || {});
  const safeName = String(name || 'Мой профиль').trim().slice(0, 80) || 'Мой профиль';
  const safeId = String(id || profileIdFromName(safeName)).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(safeId)) throw new Error('Profile id has an invalid format.');
  if (!['manual', 'local-calibration', 'gemini'].includes(source)) throw new Error('Profile source is invalid.');

  const profiles = readProfiles();
  const profile = {
    id: safeId,
    name: safeName,
    deviceId: String(deviceId || '').slice(0, 512),
    settings: validatedSettings,
    source,
    createdAt: new Date().toISOString(),
  };
  const index = profiles.findIndex((item) => item.id === safeId);
  if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  writeJsonAtomic(PROFILES_PATH, profiles);
  saveSttSettings(validatedSettings);
  return clone(profile);
}

function activateSttProfile(id) {
  const profile = readProfiles().find((item) => item.id === String(id || ''));
  if (!profile) throw new Error('STT profile not found.');
  saveSttSettings(profile.settings);
  return clone(profile);
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
  PERFORMANCE_PROFILES,
  SETTINGS_BOUNDS,
  getSttSettings,
  validateSttSettings,
  saveSttSettings,
  getSttProfiles,
  saveSttProfile,
  activateSttProfile,
  resolvePerformanceProfile,
  sttSettingsPath,
  sttProfilesPath,
  sttPreviewSettingsPath,
  sttRuntimeDir,
  defaultSttPythonPath,
  resolveSttPythonPath,
};
