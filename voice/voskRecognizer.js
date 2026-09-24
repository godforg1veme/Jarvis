const path = require("path");
const fs = require("fs");

const SAMPLE_RATE = 16000;
let vosk = null;

function loadVoskBinding() {
  if (vosk) return vosk;
  // Vosk loads libvosk.dll through FFI. Arbitrary DLLs cannot be loaded from
  // app.asar, so production must resolve Vosk's JavaScript entry point from
  // Electron Builder's explicitly unpacked directory.
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'vosk')
    : '';
  vosk = unpacked && fs.existsSync(unpacked) ? require(unpacked) : require('vosk');
  vosk.setLogLevel(-1);
  return vosk;
}

function defaultModelPath() {
  const modelName = 'vosk-model-small-ru-0.22';
  const appRoot = path.join(__dirname, '..');
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'models', modelName) : '',
    path.join(appRoot, '..', 'models', modelName),
    path.join(appRoot, 'models', modelName),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates.at(-1);
}

/**
 * Helper: Vosk v0.3.x returns parsed objects, older versions return JSON strings.
 * Handle both cases.
 */
function parseVoskResult(raw) {
  if (!raw) return "";
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  // Already an object
  return raw;
}

class VoskStreamRecognizer {
  constructor(options = {}) {
    this.model = null;
    this.recognizer = null;
    this.sampleRate = SAMPLE_RATE;
    this.modelPath = options.modelPath || defaultModelPath();
  }

  load() {
    if (!fs.existsSync(this.modelPath)) {
      throw new Error(
        'Vosk wake-word model folder not found. Reinstall Jarvis Desktop.'
      );
    }

    const expectedFiles = ["am", "conf"];
    for (const subdir of expectedFiles) {
      const subPath = path.join(this.modelPath, subdir);
      if (!fs.existsSync(subPath)) {
        throw new Error(
          `Vosk model incomplete: missing "${subdir}" in ${this.modelPath}. ` +
          'The Jarvis Desktop wake-word model may be corrupted. Reinstall the application.'
        );
      }
    }

    try {
      this.model = new (loadVoskBinding().Model)(this.modelPath);
    } catch (error) {
      throw new Error(
        `Failed to create Vosk Model from ${this.modelPath}: ${error.message}. ` +
        `The native vosk addon may be incompatible with this Node.js version.`
      );
    }

    if (!this.model) {
      throw new Error("Vosk Model was created but is null.");
    }

    try {
      this.recognizer = new (loadVoskBinding().Recognizer)({
        model: this.model,
        sampleRate: this.sampleRate,
      });
    } catch (error) {
      throw new Error(
        `Failed to create Vosk Recognizer: ${error.message}`
      );
    }

    if (!this.recognizer) {
      throw new Error("Vosk Recognizer was created but is null.");
    }
  }

  acceptPcmChunk(pcmBuffer) {
    if (!this.recognizer) {
      throw new Error("Recognizer not loaded. Call load() first.");
    }

    if (!Buffer.isBuffer(pcmBuffer)) {
      throw new Error(
        `Invalid PCM data: expected Buffer, got ${typeof pcmBuffer}`
      );
    }

    if (pcmBuffer.length === 0) {
      return { partial: "", final: "", hasFinal: false };
    }

    // Accept waveform — returns true when end of speech is detected
    const hasResult = this.recognizer.acceptWaveform(pcmBuffer);

    // Get partial result (always available during speech)
    // Vosk returns either {"partial":"text"} or {"text":"text"} as parsed object or JSON string
    let partialText = "";
    try {
      const raw = this.recognizer.partialResult();
      const parsed = parseVoskResult(raw);
      if (parsed) {
        partialText = parsed.partial || parsed.text || "";
      }
    } catch (e) {
      // Ignore
    }

    // Check for final result (only when acceptWaveform returns true)
    let finalText = "";
    if (hasResult) {
      try {
        const raw = this.recognizer.finalResult();
        const parsed = parseVoskResult(raw);
        if (parsed) {
          finalText = parsed.text || parsed.partial || "";
        }
      } catch (e) {
        // Ignore
      }
    }

    return {
      partial: partialText,
      final: finalText,
      hasFinal: finalText.length > 0,
    };
  }

  free() {
    if (this.recognizer) {
      try {
        this.recognizer.free();
      } catch (e) {
        // Ignore
      }
      this.recognizer = null;
    }
    if (this.model) {
      try {
        if (typeof this.model.free === "function") {
          this.model.free();
        }
      } catch (e) {
        // Ignore
      }
      this.model = null;
    }
  }
}

module.exports = { VoskStreamRecognizer, defaultModelPath };
