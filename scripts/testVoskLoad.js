const path = require("path");
const fs = require("fs");
const vosk = require("vosk");

vosk.setLogLevel(-1);

const modelPath = path.join(
  __dirname,
  "..",
  "models",
  "vosk-model-small-ru-0.22"
);

console.log("[test] model path:", modelPath);

if (!fs.existsSync(modelPath)) {
  console.error("[test] Vosk model folder not found");
  process.exit(1);
}

try {
  const model = new vosk.Model(modelPath);

  const recognizer = new vosk.Recognizer({
    model,
    sampleRate: 16000
  });

  recognizer.free();

  if (typeof model.free === "function") {
    model.free();
  }

  console.log("[test] Vosk loaded successfully");
  process.exit(0);
} catch (error) {
  console.error("[test] Vosk load failed:");
  console.error(error);
  process.exit(1);
}