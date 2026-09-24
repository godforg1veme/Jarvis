const { VoskStreamRecognizer } = require("./voskRecognizer");
const {
  FRAME_TYPES,
  SttFrameDecoder,
  decodeControlPayload,
} = require("./sttFrameProtocol");

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

function stopRecognizer() {
  try {
    if (recognizer) {
      recognizer.free();
      recognizer = null;
    }
  } catch (error) {
    log("Error freeing recognizer: " + error.message);
  }
}

function handleFrame(frame) {
  if (frame.type === FRAME_TYPES.CONTROL) {
    const message = decodeControlPayload(frame.payload);
    if (message.type !== "stop") {
      sendResponse({ type: "error", message: "Unknown control message type: " + message.type });
      return;
    }
    try {
      stopRecognizer();
    } catch (error) {}
    sendResponse({ type: "stopped" });
    process.exit(0);
    return;
  }

  if (frame.type === FRAME_TYPES.PCM) {
    if (!recognizer) {
      sendResponse({
        type: "error",
        message: "Recognizer is not ready. Model not loaded.",
      });
      return;
    }

    try {
      const pcmBuffer = frame.payload;
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
        sendResponse({
          type: "final",
          text: result.final,
        });
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
}

// --- Read versioned binary STT frames from stdin ---
const frameDecoder = new SttFrameDecoder();

process.stdin.on("data", (chunk) => {
  try {
    for (const frame of frameDecoder.push(chunk)) handleFrame(frame);
  } catch (error) {
    sendResponse({ type: "error", message: "STT input protocol error: " + error.message });
    log("Input protocol error: " + error.message);
    stopRecognizer();
    process.exit(1);
  }
});

process.stdin.on("end", () => {
  try {
    frameDecoder.end();
  } catch (error) {
    sendResponse({ type: "error", message: "STT input protocol error: " + error.message });
    log("Input protocol error: " + error.message);
    process.exitCode = 1;
  }
  stopRecognizer();
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
  stopRecognizer();
  process.exit(0);
});

process.on("SIGINT", () => {
  stopRecognizer();
  process.exit(0);
});

// --- Start: load model immediately ---
initRecognizer();
