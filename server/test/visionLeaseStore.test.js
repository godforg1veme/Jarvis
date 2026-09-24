const assert = require('node:assert/strict');
const test = require('node:test');
const { VisionLeaseStore } = require('../src/vision/visionLeaseStore');

function source(id = 'camera-a') { return { sourceId: id, type: 'camera', active: true, available: true, protected: false }; }

test('vision lease binds owner, device, active source, request and monotonically increasing sequence', () => {
  let now = 1000;
  let id = 0;
  const store = new VisionLeaseStore({ now: () => now, id: () => `id-${++id}` });
  const device = { id: 'device-a', user_id: 'owner-a' };
  const lease = store.create({ ownerId: 'owner-a', deviceId: 'device-a', sources: [source()] });
  const request = store.createRequest({ leaseId: lease.leaseId, device, sourceId: 'camera-a', mode: 'focused' });
  const metadata = { leaseId: lease.leaseId, captureRequestId: request.captureRequestId, sourceId: 'camera-a', mode: 'focused', sequence: 1 };
  store.acceptFrame({ leaseId: lease.leaseId, device, metadata });
  assert.throws(() => store.acceptFrame({ leaseId: lease.leaseId, device, metadata }), /VISION_CAPTURE_REPLAY/);
  assert.throws(() => store.getAuthorized(lease.leaseId, { id: 'device-b', user_id: 'owner-a' }), /VISION_DEVICE_MISMATCH/);
  assert.throws(() => store.getAuthorized(lease.leaseId, { id: 'device-a', user_id: 'owner-b' }), /VISION_OWNER_MISMATCH/);
  now = lease.expiresAt ? Date.parse(lease.expiresAt) : now + 400_000;
  assert.throws(() => store.getAuthorized(lease.leaseId, device), /VISION_LEASE_EXPIRED/);
});
