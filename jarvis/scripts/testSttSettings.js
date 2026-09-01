const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  getSttSettings,
  resolvePerformanceProfile,
  sttSettingsPath,
  sttRuntimeDir,
  defaultSttPythonPath,
} = require('../voice/sttSettings');

const settings = getSttSettings();

assert.strictEqual(settings.provider, 'faster-whisper');
assert.strictEqual(settings.fasterWhisper.device, 'cuda');
assert.strictEqual(settings.fasterWhisper.language, 'ru');
assert.strictEqual(settings.fasterWhisper.computeType, 'int8_float16');
assert.strictEqual(settings.fasterWhisper.performanceProfile, 'quality');
assert.strictEqual(settings.fasterWhisper.beamSize, 5);
assert.strictEqual(settings.fasterWhisper.vadFilter, true);
assert.strictEqual(settings.fasterWhisper.maxNoSpeechProb, 0.6);
assert.strictEqual(settings.fasterWhisper.minAvgLogProb, -1.0);
assert.strictEqual(settings.capture.channelCount, 1);
assert.strictEqual(settings.capture.noiseSuppression, true);
assert.strictEqual(settings.advisor.mode, 'problems-only');
assert.strictEqual(settings.advisor.allowAudio, false);
assert.deepStrictEqual(
  resolvePerformanceProfile({ performanceProfile: 'efficient' }),
  { performanceProfile: 'efficient', beamSize: 1, vadFilter: false },
);
assert(fs.existsSync(sttSettingsPath()), 'stt settings file must exist');
assert(fs.existsSync(sttRuntimeDir()), 'stt runtime directory must exist');
assert(defaultSttPythonPath().includes(path.join('stt_runtime', '.venv')), 'default STT Python must point at stt_runtime venv');

console.log('[test] STT settings OK');
