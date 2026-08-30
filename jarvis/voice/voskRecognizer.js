const vosk = require("vosk");
const path = require("path");
const fs = require("fs");

vosk.setLogLevel(-1);

const MODEL_PATH = path.join(__dirname, "..", "models", "vosk-model-small-ru-0.22");
const SAMPLE_RATE = 16000;

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
  constructor() {
    this.model = null;
    this.recognizer = null;
    this.sampleRate = SAMPLE_RATE;
  }

  load() {
    if (!fs.existsSync(MODEL_PATH)) {
      throw new Error(
        `Vosk model folder not found: ${MODEL_PATH}. ` +
        `Make sure the folder exists and contains model files.`
      );
    }

    const expectedFiles = ["am", "conf"];
    for (const subdir of expectedFiles) {
      const subPath = path.join(MODEL_PATH, subdir);
      if (!fs.existsSync(subPath)) {
        throw new Error(
          `Vosk model incomplete: missing "${subdir}" in ${MODEL_PATH}. ` +
          `The model folder may be corrupted. Re-download vosk-model-small-ru-0.22.`
        );
      }
    }

    try {
      this.model = new vosk.Model(MODEL_PATH);
    } catch (error) {
      throw new Error(
        `Failed to create Vosk Model from ${MODEL_PATH}: ${error.message}. ` +
        `The native vosk addon may be incompatible with this Node.js version.`
      );
    }

    if (!this.model) {
      throw new Error("Vosk Model was created but is null.");
    }

    try {
      this.recognizer = new vosk.Recognizer({
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

module.exports = { VoskStreamRecognizer };
