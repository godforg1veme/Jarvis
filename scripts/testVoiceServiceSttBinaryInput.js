const assert = require('assert');
const { EventEmitter } = require('events');
const { VoiceService } = require('../voice/voiceService');
const { FRAME_TYPES, SttFrameDecoder, decodeControlPayload } = require('../voice/sttFrameProtocol');
const { SttInputWriter } = require('../voice/sttInputWriter');

class FakeWritable extends EventEmitter {
  constructor() {
    super();
    this.writable = true;
    this.writes = [];
  }

  write(value) {
    this.writes.push(Buffer.from(value));
    return true;
  }
}

const stream = new FakeWritable();
let killCount = 0;
const service = new VoiceService({
  sttSettings: { provider: 'vosk', fasterWhisper: {}, vosk: {} },
});
service.workerProcess = {
  stdin: stream,
  kill() { killCount += 1; },
};
service.workerReady = true;
service.sttInputWriter = new SttInputWriter(stream);

service.sendPcmToWorker(new Uint8Array([1, 0, 2, 0]));

const originalSetTimeout = global.setTimeout;
try {
  global.setTimeout = (callback) => {
    callback();
    return 1;
  };
  service.stopWorker();
} finally {
  global.setTimeout = originalSetTimeout;
}

const decoder = new SttFrameDecoder();
const frames = stream.writes.flatMap((chunk) => decoder.push(chunk));
decoder.end();
assert.deepStrictEqual(frames.map((frame) => frame.type), [FRAME_TYPES.PCM, FRAME_TYPES.CONTROL]);
assert.deepStrictEqual(frames[0].payload, Buffer.from([1, 0, 2, 0]));
assert.deepStrictEqual(decodeControlPayload(frames[1].payload), { type: 'stop' });
assert.strictEqual(service.sttInputWriter, null, 'stopping must release writer listeners');
assert.strictEqual(killCount, 1, 'forced-stop fallback must remain wired');

console.log('[test] VoiceService writes framed binary PCM and stop control');
