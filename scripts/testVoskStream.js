const { VoskStreamRecognizer } = require("../voice/voskRecognizer");

console.log("[test] Creating VoskStreamRecognizer...");
const rec = new VoskStreamRecognizer();

console.log("[test] Loading model...");
try {
  rec.load();
  console.log("[test] Model loaded successfully.");
} catch (e) {
  console.error("[test] Model load FAILED:", e.message);
  process.exit(1);
}

// Generate a sine wave at 440 Hz, 16000 Hz sample rate, 2 seconds
const sampleRate = 16000;
const duration = 2;
const freq = 440;
const numSamples = sampleRate * duration;

console.log(`[test] Generating ${numSamples} samples of ${freq}Hz sine wave...`);

const pcmBuffer = Buffer.alloc(numSamples * 2);
for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  const sample = Math.round(16000 * Math.sin(2 * Math.PI * freq * t));
  pcmBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
}

console.log(`[test] PCM buffer: ${pcmBuffer.length} bytes`);

// Feed the entire buffer in chunks
const chunkSize = 4096 * 2; // 4096 samples = 8192 bytes
let chunkNum = 0;

for (let offset = 0; offset < pcmBuffer.length; offset += chunkSize) {
  const chunk = pcmBuffer.slice(offset, Math.min(offset + chunkSize, pcmBuffer.length));
  chunkNum++;

  const result = rec.acceptPcmChunk(chunk);

  if (chunkNum <= 5 || chunkNum % 10 === 0) {
    console.log(`[test] Chunk ${chunkNum}: hasFinal=${result.hasFinal} partial="${result.partial}" final="${result.final}"`);
  }
}

// Try to get final result
console.log("[test] Done feeding audio. Freeing...");
rec.free();

console.log("[test] TEST COMPLETE");