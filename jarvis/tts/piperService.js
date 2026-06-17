const fs = require('fs');
const path = require('path');
const { spawn: defaultSpawn } = require('child_process');
const {
  ensureDir,
  playWav: playWavFile,
  resolveProjectPath,
  sanitizeFilePart,
  waitForExit,
} = require('./common');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'data', 'tts-settings.json');
const DEFAULT_VOICE = 'ru_RU-irina-medium';

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'piper',
  command: 'py',
  args: ['-m', 'piper'],
  voice: DEFAULT_VOICE,
  outputDir: 'data/tts-cache',
  speakVoiceResults: true,
  cleanupWav: true,
  sentenceSilence: 0.15,
};

function loadJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function resolveSettings(rawSettings = {}, options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
  const voice = String(settings.voice || DEFAULT_VOICE).trim();
  const voiceDir = resolveProjectPath(projectRoot, settings.voiceDir || path.join('voices', 'piper'));

  const modelPath = resolveProjectPath(
    projectRoot,
    settings.modelPath || path.join(voiceDir, `${voice}.onnx`)
  );
  const configPath = resolveProjectPath(
    projectRoot,
    settings.configPath || `${modelPath}.json`
  );
  const outputDir = resolveProjectPath(projectRoot, settings.outputDir);

  return {
    ...settings,
    voice,
    voiceDir,
    modelPath,
    configPath,
    outputDir,
    args: Array.isArray(settings.args) ? settings.args.map(String) : [],
    command: String(settings.command || DEFAULT_SETTINGS.command),
    provider: String(settings.provider || DEFAULT_SETTINGS.provider),
    sentenceSilence: Number.isFinite(Number(settings.sentenceSilence))
      ? Number(settings.sentenceSilence)
      : DEFAULT_SETTINGS.sentenceSilence,
  };
}

function createPiperService(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const spawn = options.spawn || defaultSpawn;
  const fsApi = options.fs || fs;
  const writeFileSync = options.writeFileSync || fs.writeFileSync;
  const now = options.now || Date.now;

  function getSettings() {
    if (options.settings) {
      return resolveSettings(options.settings, { projectRoot });
    }

    return resolveSettings(loadJSON(options.settingsPath || SETTINGS_PATH, DEFAULT_SETTINGS), { projectRoot });
  }

  async function synthesizeToFile(text, outputFile, settings) {
    if (!fsApi.existsSync(settings.modelPath)) {
      throw new Error(`Piper model not found: ${settings.modelPath}`);
    }
    if (!fsApi.existsSync(settings.configPath)) {
      throw new Error(`Piper config not found: ${settings.configPath}`);
    }

    ensureDir(fsApi, path.dirname(outputFile));

    const args = [
      ...settings.args,
      '-m',
      settings.modelPath,
      '-c',
      settings.configPath,
      '-f',
      outputFile,
      '--sentence-silence',
      String(settings.sentenceSilence),
    ];

    const child = spawn(settings.command, args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (child.stdin && child.stdin.writable !== false) {
      child.stdin.end(String(text));
    } else {
      const inputFile = `${outputFile}.txt`;
      writeFileSync(inputFile, String(text), 'utf8');
    }

    await waitForExit(child, 'Piper TTS');

    const stats = fsApi.statSync(outputFile);
    if (!stats || stats.size <= 44) {
      throw new Error(`Piper produced an empty WAV file: ${outputFile}`);
    }
  }

  async function playWav(filePath) {
    await playWavFile(spawn, projectRoot, filePath);
  }

  async function speak(text) {
    const settings = getSettings();
    const content = String(text || '').trim();

    if (!settings.enabled || settings.provider !== 'piper') {
      return { ok: false, skipped: true, reason: 'TTS disabled' };
    }
    if (!content) {
      return { ok: false, skipped: true, reason: 'empty text' };
    }

    const fileName = `${now()}-${sanitizeFilePart(content)}.wav`;
    const outputFile = path.join(settings.outputDir, fileName);

    await synthesizeToFile(content, outputFile, settings);
    await playWav(outputFile);

    if (settings.cleanupWav !== false) {
      try { fsApi.unlinkSync(outputFile); } catch (e) {}
    }

    return { ok: true, outputFile };
  }

  return {
    speak,
    synthesizeToFile,
    playWav,
    getSettings,
  };
}

const defaultService = createPiperService();

module.exports = {
  DEFAULT_SETTINGS,
  createPiperService,
  resolveSettings,
  getSettings: defaultService.getSettings,
  speak: defaultService.speak,
};
