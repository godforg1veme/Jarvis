const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const fasterWorker = read('stt_runtime/faster_whisper_worker.py');
const voskWorker = read('voice/voskWorker.js');
const voskRecognizer = read('voice/voskRecognizer.js');
const voiceService = read('voice/voiceService.js');

for (const [name, source] of [
  ['faster-whisper worker', fasterWorker],
  ['Vosk worker', voskWorker],
  ['VoiceService', voiceService],
]) {
  assert(!/audioBase64/.test(source), `${name} must not return audioBase64`);
  assert(!/\.toString\(['"]base64['"]\)/.test(source), `${name} must not Base64-encode PCM`);
}

assert(!/audioPcm/.test(voskRecognizer), 'Vosk recognizer must not accumulate full utterance audio');
assert(fasterWorker.includes('read_frames(sys.stdin.buffer)'), 'faster-whisper must read binary frames');
assert(voskWorker.includes('new SttFrameDecoder()'), 'Vosk worker must decode binary frames');
assert(voiceService.includes('SttInputWriter'), 'VoiceService must use the bounded binary writer');

console.log('[test] STT workers use binary PCM without recognition audio payloads');
