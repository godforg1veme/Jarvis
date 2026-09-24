const assert = require('node:assert');
const {
  SceneChangeDetector,
  compareSignatures,
  grayscaleSignatureFromBgra,
} = require('../vision/sceneChangeDetector');

function signature(value, length = 64) {
  return Uint8Array.from({ length }, () => value);
}

const identical = compareSignatures(signature(100), signature(100));
assert.strictEqual(identical.changeScore, 0);
assert.strictEqual(identical.changedRatio, 0);

const brightness = compareSignatures(signature(80), signature(100));
assert.strictEqual(brightness.rawScore > 0, true);
assert.strictEqual(brightness.changeScore, 0, 'uniform brightness shift is normalized');

const changed = signature(100);
for (let index = 0; index < 20; index += 1) changed[index] = 240;
const changedMetrics = compareSignatures(signature(100), changed);
assert.strictEqual(changedMetrics.changedRatio > 0.08, true);

const detector = new SceneChangeDetector({ settleMs: 400, heartbeatMs: 30000 });
assert.strictEqual(detector.consider({ sourceId: 'camera-1', signature: signature(100), at: 0 }).reason, 'first_frame');
assert.strictEqual(detector.consider({ sourceId: 'camera-1', signature: signature(100), at: 100 }).reason, 'unchanged');
assert.strictEqual(detector.consider({ sourceId: 'camera-1', signature: changed, at: 500 }).reason, 'motion_pending');
assert.strictEqual(detector.consider({ sourceId: 'camera-1', signature: changed, at: 700 }).reason, 'motion_settling');
const stable = detector.consider({ sourceId: 'camera-1', signature: changed, at: 950 });
assert.strictEqual(stable.send, true);
assert.strictEqual(stable.reason, 'post_motion_stable');
assert.strictEqual(detector.consider({ sourceId: 'camera-1', signature: changed, at: 31000 }).reason, 'heartbeat');

const bitmap = Buffer.from([
  0, 0, 255, 255, 0, 255, 0, 255,
  255, 0, 0, 255, 255, 255, 255, 255,
]);
const sample = grayscaleSignatureFromBgra(bitmap, 2, 2, { width: 8, height: 8 });
assert.strictEqual(sample.length, 4, 'signature never upscales a tiny bitmap');
assert.strictEqual(sample[0], 76);
assert.strictEqual(sample[1], 150);

console.log('[testSceneChangeDetector] scene change detector tests passed');
