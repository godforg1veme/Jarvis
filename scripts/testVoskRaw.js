const vosk = require("vosk");
const path = require("path");
const fs = require("fs");

vosk.setLogLevel(0); // Enable logging to see what's happening

const modelPath = path.join(__dirname, "..", "models", "vosk-model-small-ru-0.22");
console.log("[test] Model path:", modelPath);
console.log("[test] Model exists:", fs.existsSync(modelPath));

if (!fs.existsSync(modelPath)) {
  console.error("[test] Model not found!");
  process.exit(1);
}

try {
  console.log("[test] Creating model...");
  const model = new vosk.Model(modelPath);
  console.log("[test] Model created OK");

  console.log("[test] Creating recognizer...");
  const rec = new vosk.Recognizer({
    model: model,
    sampleRate: 16000,
  });
  console.log("[test] Recognizer created OK");

  // Test 1: Check partialResult format
  console.log("\n[test] === Test 1: Initial partialResult ===");
  const initPartial = rec.partialResult();
  console.log("[test] initial partialResult:", initPartial);

  // Test 2: Feed silent audio (all zeros)
  console.log("\n[test] === Test 2: Silent PCM ===");
  const silentPcm = Buffer.alloc(8192);
  const res1 = rec.acceptWaveform(silentPcm);
  console.log("[test] acceptWaveform returns:", res1);

  const partial1 = rec.partialResult();
  console.log("[test] after silent PCM, partialResult:", partial1);

  // Test 3: Check the final result format
  console.log("\n[test] === Test 3: finalResult() ===");
  const final1 = rec.finalResult();
  console.log("[test] finalResult:", final1);

  console.log("\n[test] Cleaning up...");
  rec.free();
  if (typeof model.free === "function") {
    model.free();
  }
  console.log("[test] DONE");
} catch (error) {
  console.error("[test] ERROR:", error.message);
  console.error(error.stack);
}