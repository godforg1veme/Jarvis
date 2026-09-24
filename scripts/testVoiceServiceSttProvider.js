const assert = require('assert');
const path = require('path');
const { VoiceService } = require('../voice/voiceService');

function testFasterWhisperLaunch() {
  const service = new VoiceService({
    sttSettings: {
      provider: 'faster-whisper',
      readyTimeoutMs: 12345,
      fasterWhisper: {
        pythonPath: 'C:\\Python312\\python.exe',
      },
    },
  });

  const launch = service._buildWorkerLaunch();
  assert.strictEqual(launch.provider, 'faster-whisper');
  assert.strictEqual(launch.command, 'C:\\Python312\\python.exe');
  assert(launch.args.some((arg) => arg.endsWith(path.join('stt_runtime', 'faster_whisper_worker.py'))));
  assert(launch.args.includes('--settings'));
  assert.strictEqual(launch.readyTimeoutMs, 12345);
}

function testVoskLaunch() {
  const service = new VoiceService({
    sttSettings: {
      provider: 'vosk',
      readyTimeoutMs: 10000,
      fasterWhisper: {},
      vosk: {},
    },
  });

  const launch = service._buildWorkerLaunch();
  assert.strictEqual(launch.provider, 'vosk');
  assert(launch.args.some((arg) => arg.endsWith(path.join('voice', 'voskWorker.js'))));
}

testFasterWhisperLaunch();
testVoskLaunch();

console.log('[test] VoiceService STT provider launch OK');
