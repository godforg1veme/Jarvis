const assert = require("assert");
const { VoiceService } = require("../voice/voiceService");

const states = [];
const service = new VoiceService({
  onStateChange: (state) => states.push(state),
});

service.startWorker = () => true;
service.createAudioCaptureWindow = () => {};
service.startAudioCapture = () => {};
service.stopAudioCapture = () => {};
service.stopWorker = () => {};
service.destroyAudioCaptureWindow = () => {};
service._scheduleAudioCaptureStart = () => {};
service._clearReadyTimeout = () => {};

let enableResult = null;
service.enable((result) => {
  enableResult = result;
});

assert.deepStrictEqual(enableResult, { ok: true });
assert.strictEqual(service.isVoiceEnabled, true);
assert.strictEqual(states.length, 1);
assert.deepStrictEqual(states[0], {
  enabled: true,
  workerReady: false,
  audioCaptureStarted: false,
});

service.disable();

assert.strictEqual(service.isVoiceEnabled, false);
assert.strictEqual(states.length, 2);
assert.deepStrictEqual(states[1], {
  enabled: false,
  workerReady: false,
  audioCaptureStarted: false,
});

console.log("[test] voice service state change OK");
