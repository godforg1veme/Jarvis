const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "..", "voice", "audioCaptureWindow.html");
const scriptPath = path.join(__dirname, "..", "voice", "audioCaptureWindow.js");

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

const script = fs.readFileSync(scriptPath, "utf8");
assert(script.includes("navigator.mediaDevices.getUserMedia"), "audioCaptureWindow.js must request microphone input");
assert(script.includes("jarvisAudioCapture.onCommand"), "audioCaptureWindow.js must listen for capture commands");
assert(script.includes("jarvisAudioCapture.sendPcm"), "audioCaptureWindow.js must send PCM to the main process");

console.log("[test] audio capture window CSP/script structure OK");
