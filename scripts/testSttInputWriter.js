const assert = require('assert');
const { EventEmitter } = require('events');
const { SttFrameDecoder, FRAME_TYPES, decodeControlPayload } = require('../voice/sttFrameProtocol');
const { SttInputWriter } = require('../voice/sttInputWriter');

class FakeWritable extends EventEmitter {
  constructor(results = []) {
    super();
    this.results = [...results];
    this.writes = [];
    this.writable = true;
  }

  write(value) {
    this.writes.push(Buffer.from(value));
    return this.results.length ? this.results.shift() : true;
  }
}

const recovered = [];
const stream = new FakeWritable([false, true, true]);
const writer = new SttInputWriter(stream, { onRecovered: (count) => recovered.push(count) });
const pcm = Buffer.from([1, 0, 2, 0]);

assert.deepStrictEqual(writer.writePcm(pcm), { written: true, backpressured: true });
assert.deepStrictEqual(writer.writePcm(pcm), {
  written: false,
  dropped: true,
  reason: 'backpressure',
});
assert.strictEqual(stream.writes.length, 1, 'backpressured PCM must not grow the stream queue');

assert.deepStrictEqual(writer.writeControl({ type: 'stop' }), { written: true, backpressured: false });
stream.emit('drain');
assert.deepStrictEqual(recovered, [1]);
assert.deepStrictEqual(writer.writePcm(pcm), { written: true, backpressured: false });

const decoder = new SttFrameDecoder();
const frames = stream.writes.flatMap((chunk) => decoder.push(chunk));
decoder.end();
assert.deepStrictEqual(frames.map((frame) => frame.type), [
  FRAME_TYPES.PCM,
  FRAME_TYPES.CONTROL,
  FRAME_TYPES.PCM,
]);
assert.deepStrictEqual(decodeControlPayload(frames[1].payload), { type: 'stop' });

writer.destroy();
assert.deepStrictEqual(writer.writePcm(pcm), { written: false, reason: 'not-writable' });

console.log('[test] STT input backpressure writer OK');
