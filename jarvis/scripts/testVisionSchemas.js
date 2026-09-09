const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const desktop = require('../vision/visionSchemas');
const server = require('../server/src/vision/visionSchemas');

const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'server.Dockerfile'), 'utf8');
assert.match(dockerfile, /^COPY shared \/app\/shared$/m);

assert.deepStrictEqual(server.VISION_SOURCE_TYPES, desktop.VISION_SOURCE_TYPES);
assert.deepStrictEqual(server.VISION_CAPTURE_MODES, desktop.VISION_CAPTURE_MODES);
assert.deepStrictEqual(server.VISION_LEASE_STATES, desktop.VISION_LEASE_STATES);
assert.strictEqual(server.MAX_FRAME_BYTES, desktop.MAX_FRAME_BYTES);

const source = desktop.validateVisionSource({
  sourceId: 'source-camera-default',
  type: 'camera',
  active: true,
  available: true,
});
assert.deepStrictEqual(source, {
  sourceId: 'source-camera-default',
  type: 'camera',
  active: true,
  available: true,
  protected: false,
});
assert.throws(() => desktop.validateVisionSource({
  sourceId: 'source-1', type: 'microphone', active: false,
}), /source type is invalid/);
assert.throws(() => desktop.validateVisionSource({
  sourceId: 'source-1', type: 'camera', label: 'private hardware label',
}), /unknown field/);

const capturedAt = '2026-09-09T12:00:00.000Z';
const frame = desktop.validateVisionFrameMetadata({
  version: 1,
  leaseId: 'lease-1',
  captureRequestId: 'capture-1',
  frameId: 'frame-1',
  sourceId: 'source-camera-default',
  sequence: 7,
  capturedAt,
  mode: 'focused',
  contentType: 'image/jpeg',
  byteLength: 2048,
  width: 1280,
  height: 720,
  focusedReason: 'current visual question',
});
assert.strictEqual(frame.sequence, 7);
assert.throws(() => desktop.validateVisionFrameMetadata({ ...frame, byteLength: desktop.MAX_FRAME_BYTES + 1 }), /byteLength/);
assert.throws(() => desktop.validateVisionFrameMetadata({ ...frame, sequence: -1 }), /sequence/);
assert.throws(() => desktop.validateVisionFrameMetadata({ ...frame, contentType: 'image/svg+xml' }), /content type/);
assert.throws(() => desktop.validateVisionFrameMetadata({ ...frame, deviceId: 'untrusted-device' }), /unknown field/);

const observation = desktop.validateVisionObservation({
  version: 1,
  frameId: 'frame-1',
  sourceId: 'source-camera-default',
  capturedAt,
  observedAt: '2026-09-09T12:00:01.000Z',
  sceneSummary: 'A phone is on the desk.',
  sensitivity: 'none',
  confidence: 0.91,
  objects: [{
    providerId: 'phone_1', type: 'phone', description: 'black phone',
    location: 'right of laptop', state: 'on desk', confidence: 0.9,
  }],
  texts: [],
  events: [{ type: 'object_placed', subjectHint: 'phone_1', confidence: 0.8 }],
});
assert.strictEqual(observation.objects[0].type, 'phone');
assert.throws(() => desktop.validateVisionObservation({ ...observation, confidence: 1.1 }), /confidence/);
assert.throws(() => desktop.validateVisionObservation({ ...observation, sceneSummary: '' }), /sceneSummary is required/);

const memory = desktop.validateVisionMemoryMetadata({
  memoryId: 'memory-1',
  episodeId: 'episode-1',
  frameId: 'frame-1',
  sourceId: 'source-camera-default',
  state: 'stored',
  sensitivity: 'none',
  capturedAt,
  expiresAt: '2026-12-08T12:00:00.000Z',
  pinned: false,
  byteLength: 2048,
  contentHash: 'a'.repeat(64),
});
assert.strictEqual(memory.state, 'stored');
assert.throws(() => desktop.validateVisionMemoryMetadata({ ...memory, contentHash: 'not-a-hash' }), /contentHash/);

assert.strictEqual(desktop.canTransitionVisionLease('off', 'starting'), true);
assert.strictEqual(desktop.canTransitionVisionLease('active', 'stopping'), true);
assert.strictEqual(desktop.canTransitionVisionLease('active', 'active'), true);
assert.strictEqual(desktop.canTransitionVisionLease('off', 'active'), false);
assert.throws(() => desktop.assertVisionLeaseTransition('off', 'active'), /invalid vision lease transition/);

console.log('[testVisionSchemas] vision schema tests passed');
