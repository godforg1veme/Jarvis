const { VoskStreamRecognizer } = require("./voskRecognizer");

let recognizer = null;

// All output to main process MUST be JSON lines on stdout only.
function sendResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

// Logs go to stderr only.
function log(message) {
  console.error("[voice-worker]", message);
}

// --- Initialize Vosk model at startup ---
async function initRecognizer() {
  try {
    recognizer = new VoskStreamRecognizer();
    recognizer.load();
    sendResponse({ type: "ready" });
    log("Vosk model loaded, recognizer ready.");
  } catch (error) {
    sendResponse({
      type: "error",
      message: `Vosk init failed: ${error.message}`,
    });
    log(`Vosk init failed: ${error.message}`);
    process.exit(1);
  }
}

let pcmChunkCount = 0;

function handleLine(line) {
  if (!line || line.trim() === "") return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    sendResponse({ type: "error", message: "Invalid JSON: " + e.message });
    return;
  }

  if (msg.type === "stop") {
    try {
      if (recognizer) {
        recognizer.free();
        recognizer = null;
      }
    } catch (e) {
      log("Error freeing recognizer: " + e.message);
    }
    sendResponse({ type: "stopped" });
    process.exit(0);
    return;
  }

  if (msg.type === "pcm") {
    if (!recognizer) {
      sendResponse({
        type: "error",
        message: "Recognizer is not ready. Model not loaded.",
      });
      return;
    }

    try {
      const pcmBuffer = Buffer.from(msg.base64, "base64");
      pcmChunkCount++;

      // Check if audio has non-zero samples
      let maxAmplitude = 0;
      let sumAmplitude = 0;
      const sampleCount = pcmBuffer.length / 2;
      for (let i = 0; i < pcmBuffer.length; i += 2) {
        const sample = Math.abs(pcmBuffer.readInt16LE(i));
        if (sample > maxAmplitude) maxAmplitude = sample;
        sumAmplitude += sample;
      }
      const avgAmplitude = Math.round(sumAmplitude / sampleCount);

      if (pcmChunkCount <= 5 || pcmChunkCount % 50 === 0) {
        log(`PCM #${pcmChunkCount} bytes=${pcmBuffer.length} maxAmp=${maxAmplitude} avgAmp=${avgAmplitude}`);
      }

      const result = recognizer.acceptPcmChunk(pcmBuffer);

      // Log result info
      if (pcmChunkCount <= 10 || pcmChunkCount % 50 === 0) {
        log(`Result: hasFinal=${result.hasFinal} partial="${result.partial}" final="${result.final}"`);
      }

      if (result.hasFinal && result.final) {
        const audioBase64 = recognizer.getAudioBase64();
        sendResponse({
          type: "final",
          text: result.final,
          audioBase64: audioBase64,
        });
        recognizer.resetAudio();
      } else if (result.partial) {
        sendResponse({
          type: "partial",
          text: result.partial,
        });
      }
    } catch (e) {
      sendResponse({
        type: "error",
        message: "Processing error: " + e.message,
      });
      log("Processing error: " + e.message);
    }
    return;
  }

  sendResponse({ type: "error", message: "Unknown message type: " + msg.type });
}

// --- Read stdin line by line ---
process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    handleLine(line);
  }
});

process.stdin.on("end", () => {
  if (buffer.trim()) {
    handleLine(buffer);
  }
  if (recognizer) {
    recognizer.free();
  }
});

// --- Error handlers ---
process.on("uncaughtException", (error) => {
  sendResponse({
    type: "error",
    message: `Worker uncaughtException: ${error.message}`,
  });
  log(`uncaughtException: ${error.message}\n${error.stack}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  sendResponse({
    type: "error",
    message: `Worker unhandledRejection: ${String(reason)}`,
  });
  log(`unhandledRejection: ${String(reason)}`);
  process.exit(1);
});

process.on("SIGTERM", () => {
  if (recognizer) {
    recognizer.free();
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  if (recognizer) {
    recognizer.free();
  }
  process.exit(0);
});

// --- Start: load model immediately ---
initRecognizer();