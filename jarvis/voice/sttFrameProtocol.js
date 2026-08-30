const MAGIC = Buffer.from('JSTT', 'ascii');
const VERSION = 1;
const HEADER_SIZE = 10;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

const FRAME_TYPES = Object.freeze({
  PCM: 1,
  CONTROL: 2,
});

const VALID_FRAME_TYPES = new Set(Object.values(FRAME_TYPES));

class SttFrameProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SttFrameProtocolError';
  }
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new SttFrameProtocolError('STT frame payload must be Buffer, ArrayBuffer, or a typed array.');
}

function validateFrameType(type) {
  if (!VALID_FRAME_TYPES.has(type)) {
    throw new SttFrameProtocolError(`Unsupported STT frame type: ${type}.`);
  }
}

function validatePayload(type, payload) {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new SttFrameProtocolError(
      `STT frame payload is too large: ${payload.length} bytes (maximum ${MAX_PAYLOAD_BYTES}).`,
    );
  }
  if (type === FRAME_TYPES.PCM && (payload.length === 0 || payload.length % 2 !== 0)) {
    throw new SttFrameProtocolError('PCM payload must contain a non-empty, even number of PCM16 bytes.');
  }
}

function encodeFrame(type, value) {
  validateFrameType(type);
  const payload = asBuffer(value);
  validatePayload(type, payload);

  const header = Buffer.allocUnsafe(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, 4);
  header.writeUInt8(type, 5);
  header.writeUInt32LE(payload.length, 6);
  return Buffer.concat([header, payload], HEADER_SIZE + payload.length);
}

function encodePcmFrame(pcm) {
  return encodeFrame(FRAME_TYPES.PCM, pcm);
}

function encodeControlFrame(control) {
  if (!control || typeof control !== 'object' || Array.isArray(control)) {
    throw new SttFrameProtocolError('STT control payload must be an object.');
  }
  return encodeFrame(FRAME_TYPES.CONTROL, Buffer.from(JSON.stringify(control), 'utf8'));
}

function decodeControlPayload(payload) {
  let value;
  try {
    value = JSON.parse(asBuffer(payload).toString('utf8'));
  } catch (error) {
    throw new SttFrameProtocolError(`Invalid STT control JSON: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SttFrameProtocolError('STT control JSON must decode to an object.');
  }
  return value;
}

class SttFrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const incoming = asBuffer(chunk);
    if (incoming.length === 0) return [];
    this.buffer = this.buffer.length === 0
      ? Buffer.from(incoming)
      : Buffer.concat([this.buffer, incoming], this.buffer.length + incoming.length);

    const frames = [];
    while (this.buffer.length >= HEADER_SIZE) {
      if (!this.buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new SttFrameProtocolError('Invalid STT frame magic.');
      }

      const version = this.buffer.readUInt8(4);
      if (version !== VERSION) {
        throw new SttFrameProtocolError(`Unsupported STT frame version: ${version}.`);
      }

      const type = this.buffer.readUInt8(5);
      validateFrameType(type);
      const payloadLength = this.buffer.readUInt32LE(6);
      if (payloadLength > MAX_PAYLOAD_BYTES) {
        throw new SttFrameProtocolError(
          `STT frame payload is too large: ${payloadLength} bytes (maximum ${MAX_PAYLOAD_BYTES}).`,
        );
      }

      const frameLength = HEADER_SIZE + payloadLength;
      if (this.buffer.length < frameLength) break;

      const payload = Buffer.from(this.buffer.subarray(HEADER_SIZE, frameLength));
      validatePayload(type, payload);
      frames.push({ type, payload });
      this.buffer = this.buffer.subarray(frameLength);
    }
    return frames;
  }

  end() {
    if (this.buffer.length !== 0) {
      throw new SttFrameProtocolError(`Truncated STT frame: ${this.buffer.length} trailing bytes.`);
    }
  }
}

module.exports = {
  MAGIC,
  VERSION,
  HEADER_SIZE,
  MAX_PAYLOAD_BYTES,
  FRAME_TYPES,
  SttFrameProtocolError,
  SttFrameDecoder,
  asBuffer,
  encodeFrame,
  encodePcmFrame,
  encodeControlFrame,
  decodeControlPayload,
};
