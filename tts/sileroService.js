const fs = require('fs');
const path = require('path');
const { spawn: defaultSpawn } = require('child_process');
const {
  ensureDir,
  playWav,
  resolveProjectPath,
  sanitizeFilePart,
  waitForExit,
} = require('./common');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'data', 'tts-settings.json');
const DEFAULT_MODEL = 'v5_ru';
const DEFAULT_SPEAKER = 'baya';

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'silero',
  command: 'py',
  model: DEFAULT_MODEL,
  modelUrl: 'https://models.silero.ai/models/tts/ru/v5_ru.pt',
  speaker: DEFAULT_SPEAKER,
  sampleRate: 48000,
  threads: 4,
  outputDir: 'data/tts-cache',
  speakVoiceResults: true,
  cleanupWav: true,
  persistentWorker: true,
  prewarmSynthesis: true,
  warmupText: '\u0413\u043e\u0442\u043e\u0432\u043e.',
  workerReadyTimeoutMs: 30000,
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
  const model = String(settings.model || DEFAULT_MODEL).trim();
  const modelDir = resolveProjectPath(projectRoot, settings.modelDir || path.join('voices', 'silero'));
  const modelPath = resolveProjectPath(projectRoot, settings.modelPath || path.join(modelDir, `${model}.pt`));
  const scriptPath = resolveProjectPath(projectRoot, settings.scriptPath || path.join('scripts', 'sileroSpeak.py'));
  const workerScriptPath = resolveProjectPath(projectRoot, settings.workerScriptPath || path.join('scripts', 'sileroWorker.py'));
  const outputDir = resolveProjectPath(projectRoot, settings.outputDir || DEFAULT_SETTINGS.outputDir);

  return {
    ...settings,
    provider: String(settings.provider || DEFAULT_SETTINGS.provider),
    command: String(settings.command || DEFAULT_SETTINGS.command),
    model,
    modelDir,
    modelPath,
    scriptPath,
    workerScriptPath,
    outputDir,
    modelUrl: String(settings.modelUrl || DEFAULT_SETTINGS.modelUrl),
    speaker: String(settings.speaker || DEFAULT_SPEAKER),
    sampleRate: Number(settings.sampleRate || DEFAULT_SETTINGS.sampleRate),
    threads: Number(settings.threads || DEFAULT_SETTINGS.threads),
    persistentWorker: settings.persistentWorker !== false,
    prewarmSynthesis: settings.prewarmSynthesis !== false,
    warmupText: String(settings.warmupText || DEFAULT_SETTINGS.warmupText),
    workerReadyTimeoutMs: Number(settings.workerReadyTimeoutMs || DEFAULT_SETTINGS.workerReadyTimeoutMs),
  };
}

function createSileroService(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const spawn = options.spawn || defaultSpawn;
  const fsApi = options.fs || fs;
  const now = options.now || Date.now;
  let workerClient = null;

  function getSettings() {
    if (options.settings) {
      return resolveSettings(options.settings, { projectRoot });
    }

    return resolveSettings(loadJSON(options.settingsPath || SETTINGS_PATH, DEFAULT_SETTINGS), { projectRoot });
  }

  function validateRequiredFiles(settings, scriptPath) {
    if (!fsApi.existsSync(settings.modelPath)) {
      throw new Error(`Silero model not found: ${settings.modelPath}`);
    }
    if (!fsApi.existsSync(scriptPath)) {
      throw new Error(`Silero script not found: ${scriptPath}`);
    }
  }

  function validateSynthesisFiles(outputFile, settings, scriptPath) {
    validateRequiredFiles(settings, scriptPath);
    ensureDir(fsApi, path.dirname(outputFile));
  }

  async function synthesizeToFileOnce(text, outputFile, settings) {
    validateSynthesisFiles(outputFile, settings, settings.scriptPath);

    const args = [
      settings.scriptPath,
      '--model-path',
      settings.modelPath,
      '--speaker',
      settings.speaker,
      '--sample-rate',
      String(settings.sampleRate),
      '--threads',
      String(settings.threads),
      '--output-file',
      outputFile,
    ];

    const child = spawn(settings.command, args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (child.stdin && child.stdin.writable !== false) {
      child.stdin.end(String(text));
    }

    await waitForExit(child, 'Silero TTS');
    validateOutputFile(outputFile);
  }

  function validateOutputFile(outputFile) {
    const stats = fsApi.statSync(outputFile);
    if (!stats || stats.size <= 44) {
      throw new Error(`Silero produced an empty WAV file: ${outputFile}`);
    }
  }

  function createWorkerKey(settings) {
    return [
      settings.command,
      settings.workerScriptPath,
      settings.modelPath,
      settings.speaker,
      settings.sampleRate,
      settings.threads,
    ].join('\n');
  }

  function destroyWorker() {
    if (workerClient && typeof workerClient.kill === 'function') {
      workerClient.kill();
    }
    workerClient = null;
  }

  function createWorkerClient(settings) {
    const key = createWorkerKey(settings);
    const pending = new Map();
    let nextId = 1;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let exited = false;
    let warmedUp = false;

    const args = [
      settings.workerScriptPath,
      '--model-path',
      settings.modelPath,
      '--speaker',
      settings.speaker,
      '--sample-rate',
      String(settings.sampleRate),
      '--threads',
      String(settings.threads),
    ];

    const child = spawn(settings.command, args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const ready = new Promise((resolve, reject) => {
      const readyTimeout = setTimeout(() => {
        reject(new Error(`Silero worker did not become ready in ${settings.workerReadyTimeoutMs}ms.`));
      }, settings.workerReadyTimeoutMs);

      function resolveReady() {
        clearTimeout(readyTimeout);
        resolve();
      }

      function rejectReady(error) {
        clearTimeout(readyTimeout);
        reject(error);
      }

      child.on('error', rejectReady);
      child.on('exit', code => {
        exited = true;
        const detail = stderrBuffer.trim() || `exit code ${code}`;
        const error = new Error(`Silero worker exited before ready: ${detail}`);
        rejectReady(error);
        for (const { reject: rejectPending } of pending.values()) {
          rejectPending(new Error(`Silero worker exited: ${detail}`));
        }
        pending.clear();
        if (workerClient && workerClient.child === child) workerClient = null;
      });

      if (child.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', chunk => {
          stderrBuffer += chunk.toString();
        });
      }

      if (child.stdout && typeof child.stdout.on === 'function') {
        child.stdout.on('data', chunk => {
          stdoutBuffer += chunk.toString();
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;

            let message;
            try {
              message = JSON.parse(line);
            } catch (error) {
              continue;
            }

            if (message.type === 'ready') {
              resolveReady();
              continue;
            }

            if (message.type === 'error' && !message.id) {
              rejectReady(new Error(message.error || 'Silero worker failed to start.'));
              continue;
            }

            if (!message.id || !pending.has(message.id)) continue;

            const request = pending.get(message.id);
            pending.delete(message.id);
            if (message.ok) {
              request.resolve(message);
            } else {
              request.reject(new Error(message.error || 'Silero worker failed.'));
            }
          }
        });
      }
    });

    async function synthesizeRequest(text, outputFile) {
      await ready;
      if (exited || !child.stdin || child.stdin.writable === false) {
        throw new Error('Silero worker is not available.');
      }

      const id = nextId++;
      const payload = JSON.stringify({ id, text: String(text), outputFile }) + '\n';
      const response = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      child.stdin.write(payload);
      return response;
    }

    return {
      key,
      child,
      kill() {
        for (const { reject } of pending.values()) {
          reject(new Error('Silero worker stopped.'));
        }
        pending.clear();
        if (child.kill && !exited) child.kill();
      },
      ready() {
        return ready;
      },
      async warmup(text, outputFile) {
        if (warmedUp) return { ok: true, skipped: true, reason: 'already warmed' };
        const result = await synthesizeRequest(text, outputFile);
        warmedUp = true;
        return result;
      },
      async synthesize(text, outputFile) {
        return synthesizeRequest(text, outputFile);
      },
    };
  }

  function getWorkerClient(settings) {
    const key = createWorkerKey(settings);
    if (!workerClient || workerClient.key !== key) {
      destroyWorker();
      workerClient = createWorkerClient(settings);
    }
    return workerClient;
  }

  async function synthesizeToFileWithWorker(text, outputFile, settings) {
    validateSynthesisFiles(outputFile, settings, settings.workerScriptPath);
    const client = getWorkerClient(settings);
    await client.synthesize(text, outputFile);
    validateOutputFile(outputFile);
  }

  async function synthesizeToFile(text, outputFile, settings) {
    if (settings.persistentWorker) {
      try {
        await synthesizeToFileWithWorker(text, outputFile, settings);
        return;
      } catch (error) {
        destroyWorker();
        throw error;
      }
    }

    await synthesizeToFileOnce(text, outputFile, settings);
  }

  async function prepare() {
    const settings = getSettings();

    if (!settings.enabled || settings.provider !== 'silero' || !settings.persistentWorker) {
      return { ok: false, skipped: true, reason: 'Silero persistent worker disabled' };
    }

    validateRequiredFiles(settings, settings.workerScriptPath);
    const client = getWorkerClient(settings);
    await client.ready();

    if (settings.prewarmSynthesis) {
      ensureDir(fsApi, settings.outputDir);
      const warmupFile = path.join(settings.outputDir, `${now()}-silero-warmup.wav`);
      await client.warmup(settings.warmupText, warmupFile);
      validateOutputFile(warmupFile);
      try { fsApi.unlinkSync(warmupFile); } catch (e) {}
    }

    return { ok: true, warmed: true };
  }

  async function speak(text) {
    const settings = getSettings();
    const content = String(text || '').trim();

    if (!settings.enabled || settings.provider !== 'silero') {
      return { ok: false, skipped: true, reason: 'TTS disabled' };
    }
    if (!content) {
      return { ok: false, skipped: true, reason: 'empty text' };
    }

    const fileName = `${now()}-${sanitizeFilePart(content)}.wav`;
    const outputFile = path.join(settings.outputDir, fileName);

    await synthesizeToFile(content, outputFile, settings);
    await playWav(spawn, projectRoot, outputFile);

    if (settings.cleanupWav !== false) {
      try { fsApi.unlinkSync(outputFile); } catch (e) {}
    }

    return { ok: true, outputFile };
  }

  return {
    prepare,
    speak,
    synthesizeToFile,
    getSettings,
    destroyWorker,
  };
}

const defaultService = createSileroService();

module.exports = {
  DEFAULT_SETTINGS,
  createSileroService,
  resolveSettings,
  getSettings: defaultService.getSettings,
  speak: defaultService.speak,
};
