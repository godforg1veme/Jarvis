const assert = require('assert');
const {
  FRAME_TYPES,
  HEADER_SIZE,
  MAX_PAYLOAD_BYTES,
  SttFrameDecoder,
  decodeControlPayload,
  encodeControlFrame,
  encodePcmFrame,
} = require('../voice/sttFrameProtocol');

function decodeChunks(chunks) {
  const decoder = new SttFrameDecoder();
  const frames = chunks.flatMap((chunk) => decoder.push(chunk));
  decoder.end();
  return frames;
}

const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const pcmFrame = encodePcmFrame(pcm);
const fragmented = decodeChunks([...pcmFrame].map((byte) => Buffer.from([byte])));
assert.strictEqual(fragmented.length, 1);
assert.strictEqual(fragmented[0].type, FRAME_TYPES.PCM);
assert.deepStrictEqual(fragmented[0].payload, pcm);

const controlFrame = encodeControlFrame({ type: 'stop' });
const combined = decodeChunks([Buffer.concat([pcmFrame, controlFrame])]);
assert.strictEqual(combined.length, 2);
assert.deepStrictEqual(decodeControlPayload(combined[1].payload), { type: 'stop' });

assert.throws(() => encodePcmFrame(Buffer.alloc(0)), /non-empty/);
assert.throws(() => encodePcmFrame(Buffer.alloc(3)), /even number/);
assert.throws(() => encodePcmFrame(Buffer.alloc(MAX_PAYLOAD_BYTES + 2)), /too large/);

const invalidMagic = Buffer.from(pcmFrame);
invalidMagic.write('FAIL', 0, 'ascii');
assert.throws(() => new SttFrameDecoder().push(invalidMagic), /magic/);

const invalidVersion = Buffer.from(pcmFrame);
invalidVersion.writeUInt8(99, 4);
assert.throws(() => new SttFrameDecoder().push(invalidVersion), /version/);

const invalidType = Buffer.from(pcmFrame);
invalidType.writeUInt8(99, 5);
assert.throws(() => new SttFrameDecoder().push(invalidType), /type/);

const oversized = Buffer.alloc(HEADER_SIZE);
oversized.write('JSTT', 0, 'ascii');
oversized.writeUInt8(1, 4);
oversized.writeUInt8(FRAME_TYPES.PCM, 5);
oversized.writeUInt32LE(MAX_PAYLOAD_BYTES + 1, 6);
assert.throws(() => new SttFrameDecoder().push(oversized), /too large/);

const truncated = new SttFrameDecoder();
truncated.push(pcmFrame.subarray(0, pcmFrame.length - 1));
assert.throws(() => truncated.end(), /Truncated/);

console.log('[test] STT binary frame protocol OK');
