const assert = require('node:assert/strict');
const { SceneStateStore } = require('../server/src/vision/sceneState');

let now = Date.parse('2026-09-09T10:00:00.000Z');
const store = new SceneStateStore({ now: () => now, historyLimit: 2 });
function observation(frameId, summary, providerId = 'cup-1') {
  return {
    frameId, sourceId: 'camera-a', capturedAt: new Date(now).toISOString(),
    observedAt: new Date(now).toISOString(), sceneSummary: summary,
    sensitivity: 'none', confidence: .9,
    objects: [{ providerId, type: 'cup', description: 'red ceramic cup', location: summary, state: '', confidence: .9 }],
    events: [], texts: [],
  };
}
const first = store.update({ ownerId: 'owner-a', deviceId: 'device-a', observation: observation('frame-1', 'left') });
now += 1000;
const second = store.update({ ownerId: 'owner-a', deviceId: 'device-a', observation: observation('frame-2', 'right') });
assert.equal(second.objects[0].objectId, first.objects[0].objectId);
now += 1000;
store.update({ ownerId: 'owner-a', deviceId: 'device-a', observation: observation('frame-3', 'center') });
assert.equal(store.contextFor({ ownerId: 'owner-a', deviceId: 'device-a', sourceId: 'camera-a' }).historyCount, 2);
assert.equal(store.contextFor({ ownerId: 'owner-b', deviceId: 'device-a', sourceId: 'camera-a' }), null);
now += 31_000;
assert.equal(store.contextFor({ ownerId: 'owner-a', deviceId: 'device-a', sourceId: 'camera-a' }).fresh, false);
store.clearDevice('owner-a', 'device-a');
assert.equal(store.contextFor({ ownerId: 'owner-a', deviceId: 'device-a', sourceId: 'camera-a' }), null);
console.log('Scene state tests passed.');
