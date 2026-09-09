const assert = require('node:assert/strict');
const { VisualSourceRegistry } = require('../vision/visualSourceRegistry');
const { VisionRuntime } = require('../vision/visionRuntime');

(async () => {
  const registry = new VisualSourceRegistry({ createId: (() => { let id = 0; return () => `source-${++id}`; })() });
  const cameraSource = registry.upsert({ type: 'camera', nativeId: 'camo', label: 'Camo', available: true });
  const displayA = registry.upsert({ type: 'display', nativeId: '1', label: 'Display 1', displayIndex: 0, available: true });
  const displayB = registry.upsert({ type: 'display', nativeId: '2', label: 'Display 2', displayIndex: 1, available: true });
  let cameraActive = false;
  const camera = {
    async listCameras() { return [cameraSource]; },
    async start(id) { assert.equal(id, cameraSource.sourceId); cameraActive = true; },
    async capture() { assert.equal(cameraActive, true); return { sourceId: cameraSource.sourceId, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg', width: 1, height: 1, capturedAt: '2026-09-09T10:00:00.000Z' }; },
    async stop() { cameraActive = false; }, async close() { cameraActive = false; },
  };
  const screenCapture = {
    listDisplays() { return [displayA, displayB]; },
    async captureWorkspace(ids, options) { assert.deepEqual(ids, [displayA.sourceId, displayB.sourceId]); return { sourceId: options.workspaceSourceId, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg', width: 2, height: 1, capturedAt: '2026-09-09T10:00:00.000Z' }; },
  };
  let request = 0;
  const uploads = [];
  const transport = {
    async createLease({ sources }) { assert.equal(sources.length, 2); return { leaseId: 'lease-a' }; },
    async requestCapture(_lease, input) { return { captureRequestId: `request-${++request}-${input.sourceId}` }; },
    async uploadFrame(_lease, metadata) { uploads.push(metadata); return { observation: { version: 1, frameId: metadata.frameId, sourceId: metadata.sourceId, capturedAt: metadata.capturedAt, observedAt: metadata.capturedAt, sceneSummary: `seen:${metadata.sourceId}`, sensitivity: 'none', confidence: 1, objects: [], texts: [], events: [] }, memory: { retentionConsentRequired: false } }; },
    async stopLease() {},
    async setSensitiveConsent() {},
  };
  const runtime = new VisionRuntime({ sourceRegistry: registry, camera, screenCapture, transport, getDeviceState: () => ({ paired: true, deviceId: 'device-a' }), expiryPollMs: 100000 });
  const started = await runtime.start({ cameraSourceId: cameraSource.sourceId, includeCamera: true, includeScreens: true });
  assert.equal(started.ok, true);
  assert.equal(cameraActive, true);
  const result = await runtime.analyze({ prompt: 'Что видно?' });
  assert.equal(result.ok, true);
  assert.equal(uploads.length, 2);
  assert.deepEqual(uploads.map((item) => item.sequence), [1, 1]);
  await runtime.stop();
  assert.equal(cameraActive, false);
  await runtime.close();

  const emptyRegistry = new VisualSourceRegistry();
  const missingCameraRuntime = new VisionRuntime({
    sourceRegistry: emptyRegistry,
    camera: { async listCameras() { return []; }, async start() {}, async capture() {}, async stop() {}, async close() {} },
    screenCapture,
    transport,
    getDeviceState: () => ({ paired: true, deviceId: 'device-a' }),
    expiryPollMs: 100000,
  });
  const missingCamera = await missingCameraRuntime.start({ includeCamera: true, includeScreens: true });
  assert.equal(missingCamera.ok, false);
  assert.match(missingCamera.error, /Camo Studio/u);
  await missingCameraRuntime.close();
  console.log('Vision runtime tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
