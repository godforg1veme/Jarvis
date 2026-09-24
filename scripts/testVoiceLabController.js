const assert = require('assert');
const fs = require('fs');
const { VoiceLabController } = require('../voice/voiceLabController');
const { getSttSettings, sttPreviewSettingsPath } = require('../voice/sttSettings');

function pcm(level, samples = 1600) {
  const value = Math.round(level * 32767);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(value, index * 2);
  return buffer;
}

const fakeVoiceService = {
  sttSettings: getSttSettings(),
  events: [],
  setVoiceLabController(controller) { this.controller = controller; },
  broadcastVoiceLab(type, payload) { this.events.push({ type, payload }); },
  getRecentPcm() { return Buffer.alloc(0); },
  clearRecentPcm() {},
  restartForSettings(settings, settingsPath) {
    this.sttSettings = settings;
    this.settingsPath = settingsPath;
    return Promise.resolve({ ok: true, restarted: false });
  },
};

const controller = new VoiceLabController({
  voiceService: fakeVoiceService,
  geminiAdvisor: { getStatus: () => ({ configured: false, mode: 'problems-only', allowAudio: false }), analyze: async () => ({ ok: false }) },
});

controller.startCalibration();
for (let index = 0; index < 5; index += 1) controller.onPcm(pcm(0.002), fakeVoiceService.sttSettings);
controller.nextCalibrationStep();
for (let index = 0; index < 5; index += 1) controller.onPcm(pcm(0.06), fakeVoiceService.sttSettings);
controller.onFinalResult('открой стим');

controller.finishCalibration().then((result) => {
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.preview.active, true);
  assert(fakeVoiceService.settingsPath.endsWith('stt-settings.preview.json'));
  assert(fakeVoiceService.events.some((event) => event.type === 'calibration'));
  try { fs.unlinkSync(sttPreviewSettingsPath()); } catch (e) {}
  console.log('[test] Voice Lab controller calibration and preview flow OK');
}).catch((error) => {
  try { fs.unlinkSync(sttPreviewSettingsPath()); } catch (e) {}
  console.error(error);
  process.exitCode = 1;
});
