const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "..", "voice", "audioCaptureWindow.html");
const scriptPath = path.join(__dirname, "..", "voice", "audioCaptureWindow.js");
const workletPath = path.join(__dirname, "..", "voice", "pcmCaptureProcessor.js");

const html = fs.readFileSync(htmlPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]);
const inlineScriptTags = scriptTags.filter((attrs) => !/\bsrc\s*=/i.test(attrs));

assert(scriptTags.length > 0, "audio capture window must load a script");
assert(inlineScriptTags.length === 0, "audio capture window must not use inline scripts under strict CSP");
assert(/<script\b[^>]*\bsrc=["']audioCaptureWindow\.js["']/i.test(html), "audio capture window must load audioCaptureWindow.js");
assert(html.includes("</script>"), "audio capture window must close its script tag");
assert(html.includes("</body>"), "audio capture window must close body");
assert(html.includes("</html>"), "audio capture window must close html");
assert(fs.existsSync(scriptPath), "audioCaptureWindow.js must exist");
assert(fs.existsSync(workletPath), "pcmCaptureProcessor.js must exist");
assert(/worker-src\s+'self'/.test(html), "audio capture CSP must allow the local AudioWorklet module");

const script = fs.readFileSync(scriptPath, "utf8");
assert(script.includes("navigator.mediaDevices.getUserMedia"), "audioCaptureWindow.js must request microphone input");
assert(script.includes("jarvisAudioCapture.onCommand"), "audioCaptureWindow.js must listen for capture commands");
assert(script.includes("jarvisAudioCapture.sendPcm"), "audioCaptureWindow.js must send PCM to the main process");
assert(script.includes("audioWorklet.addModule"), "audio capture must load an AudioWorklet module");
assert(script.includes("new window.AudioWorkletNode"), "AudioWorklet must be the primary capture backend");
assert(script.includes("createScriptProcessor"), "audio capture must retain a compatibility fallback");
assert(script.includes("captureGeneration"), "audio capture must invalidate an in-flight asynchronous start on stop");
assert(script.includes("captureRequested = false"), "audio capture stop must cancel pending capture requests");

const worklet = fs.readFileSync(workletPath, "utf8");
assert(worklet.includes("registerProcessor('jarvis-pcm-capture'"), "worklet processor must be registered");
assert(worklet.includes("TARGET_SAMPLE_RATE = 16000"), "worklet must output 16 kHz PCM");
assert(worklet.includes("[buffer]"), "worklet must transfer completed PCM buffers");

console.log("[test] audio capture window CSP/script structure OK");
