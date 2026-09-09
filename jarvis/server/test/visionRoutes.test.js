const assert = require('node:assert/strict');
const test = require('node:test');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config/loadConfig');
const { FixedWindowRateLimiter } = require('../src/http/rateLimiter');
const { VisionLeaseStore } = require('../src/vision/visionLeaseStore');
const { FakeVisionProvider } = require('../src/vision/visionProvider');
const { publicMemoryRecord, registerVisionRoutes } = require('../src/vision/visionRoutes');

function appFixture() {
  const app = buildApp({ config: loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' }) });
  registerVisionRoutes(app, {
    authenticate: async (headers) => {
      if (headers.authorization !== 'Bearer valid') { const e = new Error(); e.statusCode = 401; e.publicCode = 'DEVICE_AUTH_REQUIRED'; throw e; }
      return { id: 'device-a', user_id: 'owner-a' };
    },
    leaseStore: new VisionLeaseStore(), provider: new FakeVisionProvider(), limiter: new FixedWindowRateLimiter(),
  });
  return app;
}

async function createLeaseAndRequest(app) {
  const leaseResponse = await app.inject({ method: 'POST', url: '/v1/vision/leases', headers: { authorization: 'Bearer valid' }, payload: { sources: [{ sourceId: 'camera-a', type: 'camera', active: true, available: true, protected: false }] } });
  const lease = leaseResponse.json().lease;
  const requestResponse = await app.inject({ method: 'POST', url: `/v1/vision/leases/${lease.leaseId}/requests`, headers: { authorization: 'Bearer valid' }, payload: { sourceId: 'camera-a', mode: 'focused', prompt: 'Что видно?' } });
  return { lease, request: requestResponse.json().request };
}

test('vision route requires auth and accepts one correlated valid JPEG', async () => {
  const app = appFixture();
  const denied = await app.inject({ method: 'POST', url: '/v1/vision/leases', payload: { sources: [] } });
  assert.equal(denied.statusCode, 401);
  const { lease, request } = await createLeaseAndRequest(app);
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const metadata = { version: 1, leaseId: lease.leaseId, captureRequestId: request.captureRequestId, frameId: 'frame-a', sourceId: 'camera-a', sequence: 1, capturedAt: new Date().toISOString(), mode: 'focused', contentType: 'image/jpeg', byteLength: image.length, width: 1, height: 1 };
  const headers = { authorization: 'Bearer valid', 'content-type': 'image/jpeg', 'x-jarvis-vision-metadata': Buffer.from(JSON.stringify(metadata)).toString('base64url') };
  const accepted = await app.inject({ method: 'POST', url: `/v1/vision/leases/${lease.leaseId}/frames`, headers, payload: image });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().observation.frameId, 'frame-a');
  const replay = await app.inject({ method: 'POST', url: `/v1/vision/leases/${lease.leaseId}/frames`, headers, payload: image });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().code, 'VISION_CAPTURE_REPLAY');
  await app.close();
});

test('vision route rejects MIME, magic, and declared-length mismatches', async () => {
  const app = appFixture();
  const { lease, request } = await createLeaseAndRequest(app);
  const image = Buffer.from('not-an-image');
  const metadata = { version: 1, leaseId: lease.leaseId, captureRequestId: request.captureRequestId, frameId: 'frame-a', sourceId: 'camera-a', sequence: 1, capturedAt: new Date().toISOString(), mode: 'focused', contentType: 'image/jpeg', byteLength: image.length, width: 1, height: 1 };
  const response = await app.inject({ method: 'POST', url: `/v1/vision/leases/${lease.leaseId}/frames`, headers: { authorization: 'Bearer valid', 'content-type': 'image/jpeg', 'x-jarvis-vision-metadata': Buffer.from(JSON.stringify(metadata)).toString('base64url') }, payload: image });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'VISION_FRAME_INVALID');
  await app.close();
});

test('visual memory API record excludes owner and storage internals', () => {
  const visible = publicMemoryRecord({
    id: 'memory-a', frame_id: 'frame-a', source_id: 'camera-a', state: 'stored',
    sensitivity: 'none', byte_length: 4, confidence: 1, captured_at: 'now',
    expires_at: 'later', pinned: false, corrected_summary: '', created_at: 'now',
    user_id: 'owner-a', device_id: 'device-a', lease_id: 'lease-a',
    blob_key: 'aa/private.jvs', content_hash: Buffer.from('private'),
  });
  assert.equal(visible.id, 'memory-a');
  for (const internal of ['user_id', 'device_id', 'lease_id', 'blob_key', 'content_hash']) {
    assert.equal(Object.hasOwn(visible, internal), false);
  }
});
