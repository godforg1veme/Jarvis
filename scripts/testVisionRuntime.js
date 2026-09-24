const assert = require('node:assert/strict');
const { VisualSourceRegistry } = require('../vision/visualSourceRegistry');
const { VisionRuntime } = require('../vision/visionRuntime');
const { FrameSampler } = require('../vision/frameSampler');

(async () => {
  const registry = new VisualSourceRegistry({ createId: (() => { let id = 0; return () => `source-${++id}`; })() });
  const cameraSource = registry.upsert({ type: 'camera', nativeId: 'camo', label: 'Camo', available: true });
  const displayA = registry.upsert({ type: 'display', nativeId: '1', label: 'Display 1', displayIndex: 0, available: true });
  const displayB = registry.upsert({ type: 'display', nativeId: '2', label: 'Display 2', displayIndex: 1, available: true });
  let cameraActive = false;
  const camera = {
    async listCameras() { return [cameraSource]; },
    async start(id) { assert.equal(id, cameraSource.sourceId); cameraActive = true; },
    async capture() { assert.equal(cameraActive, true); return { sourceId: cameraSource.sourceId, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg', width: 1, height: 1, capturedAt: '2026-09-09T10:00:00.000Z', signature: new Uint8Array(64) }; },
    async stop() { cameraActive = false; }, async close() { cameraActive = false; },
  };
  const screenCapture = {
    listDisplays() { return [displayA, displayB]; },
    async captureWorkspace(ids, options) { assert.deepEqual(ids, [displayA.sourceId, displayB.sourceId]); return { sourceId: options.workspaceSourceId, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg', width: 2, height: 1, capturedAt: '2026-09-09T10:00:00.000Z', signature: new Uint8Array(64) }; },
  };
  let request = 0;
  const uploads = [];
  const transport = {
    async createLease({ sources }) { assert.equal(sources.length, 2); return { leaseId: 'lease-a' }; },
    async requestCapture(_lease, input) { return { captureRequestId: `request-${++request}-${input.sourceId}` }; },
    async uploadFrame(_lease, metadata) { uploads.push(metadata); return { observation: { version: 1, frameId: metadata.frameId, sourceId: metadata.sourceId, capturedAt: metadata.capturedAt, observedAt: metadata.capturedAt, sceneSummary: `seen:${metadata.sourceId}`, sensitivity: 'none', confidence: 1, objects: [], texts: [], events: [] }, memory: { retentionConsentRequired: metadata.mode === 'temporal' } }; },
    async stopLease() {},
    async setSensitiveConsent() {},
  };
  const consentEvents = [];
  const runtime = new VisionRuntime({ sourceRegistry: registry, camera, screenCapture, transport, sampler: new FrameSampler({ sourceIntervalMs: 1, focusedIntervalMs: 1 }), getDeviceState: () => ({ paired: true, deviceId: 'device-a' }), expiryPollMs: 100000, temporalPollMs: 100000, emitSensitiveConsentRequired: (payload) => consentEvents.push(payload) });
  const started = await runtime.start({ cameraSourceId: cameraSource.sourceId, includeCamera: true, includeScreens: true });
  assert.equal(started.ok, true);
  assert.equal(cameraActive, true);
  const result = await runtime.analyze({ prompt: 'Что видно?' });
  assert.equal(result.ok, true);
  assert.equal(uploads.length, 2);
  assert.deepEqual(uploads.map((item) => item.sequence), [1, 1]);
  await new Promise((resolve) => setTimeout(resolve, 2));
  await runtime._pollTemporal();
  assert.equal(uploads.length, 4);
  assert.deepEqual(uploads.slice(2).map((item) => item.mode), ['temporal', 'temporal']);
  assert.deepEqual(consentEvents, [{ sourceIds: [cameraSource.sourceId] }, { sourceIds: [registry.listLocal().find((item) => item.type === 'screen_workspace').sourceId] }]);
  await runtime._pollTemporal();
  assert.equal(uploads.length, 4);
  await runtime.setSensitiveConsent(cameraSource.sourceId, false);
  assert.equal(runtime.publicState().pendingSensitiveSourceIds.includes(cameraSource.sourceId), false);
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
    expiryPollMs: 100000, temporalPollMs: 100000,
  });
  const missingCamera = await missingCameraRuntime.start({ includeCamera: true, includeScreens: true });
  assert.equal(missingCamera.ok, false);
  assert.match(missingCamera.error, /Camo Studio/u);
  await missingCameraRuntime.close();

  const raceRegistry = new VisualSourceRegistry();
  const raceSource = raceRegistry.upsert({ type: 'camera', nativeId: 'race-camera', label: 'Race camera', available: true });
  let releaseCapture; let captureEntered;
  const entered = new Promise((resolve) => { captureEntered = resolve; });
  const raceUploads = [];
  const raceRuntime = new VisionRuntime({
    sourceRegistry: raceRegistry,
    camera: {
      async listCameras() { return [raceSource]; }, async start() {}, async stop() {}, async close() {},
      async capture() { captureEntered(); await new Promise((resolve) => { releaseCapture = resolve; }); return { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg', width: 1, height: 1, capturedAt: new Date().toISOString(), signature: new Uint8Array(64) }; },
    },
    screenCapture: { listDisplays() { return []; } },
    transport: {
      async createLease() { return { leaseId: 'race-lease' }; }, async requestCapture() { return { captureRequestId: 'race-request' }; },
      async uploadFrame(...args) { raceUploads.push(args); return {}; }, async stopLease() {},
    },
    getDeviceState: () => ({ paired: true, deviceId: 'device-a' }),
    expiryPollMs: 100000, temporalPollMs: 100000,
  });
  assert.equal((await raceRuntime.start({ cameraSourceId: raceSource.sourceId, includeCamera: true, includeScreens: false })).ok, true);
  const pendingAnalysis = raceRuntime.analyze({ prompt: 'Что видно?', target: 'camera' });
  await entered;
  await raceRuntime.stop('test_stop_race');
  releaseCapture();
  const cancelled = await pendingAnalysis;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.code, 'VISION_CAPTURE_CANCELLED');
  assert.equal(raceUploads.length, 0, 'STOP must prevent an in-flight frame from uploading');
  await raceRuntime.close();

  const uploadRegistry = new VisualSourceRegistry();
  const uploadSource = uploadRegistry.upsert({ type: 'camera', nativeId: 'upload-camera', label: 'Upload camera', available: true });
  let uploadEntered;
  const uploading = new Promise((resolve) => { uploadEntered = resolve; });
  let uploadAborted = false;
  const uploadRuntime = new VisionRuntime({
    sourceRegistry: uploadRegistry,
    camera: {
      async listCameras() { return [uploadSource]; }, async start() {}, async stop() {}, async close() {},
      async capture() { return { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg', width: 1, height: 1, capturedAt: new Date().toISOString(), signature: new Uint8Array(64) }; },
    },
    screenCapture: { listDisplays() { return []; } },
    transport: {
      async createLease() { return { leaseId: 'upload-lease' }; }, async requestCapture() { return { captureRequestId: 'upload-request' }; },
      async uploadFrame(_lease, _metadata, _bytes, options) {
        uploadEntered();
        await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
          uploadAborted = true;
          const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
        }, { once: true }));
      },
      async stopLease() {},
    },
    getDeviceState: () => ({ paired: true, deviceId: 'device-a' }),
    expiryPollMs: 100000, temporalPollMs: 100000,
  });
  assert.equal((await uploadRuntime.start({ cameraSourceId: uploadSource.sourceId, includeCamera: true, includeScreens: false })).ok, true);
  const uploadingAnalysis = uploadRuntime.analyze({ prompt: 'Что видно?', target: 'camera' });
  await uploading;
  await uploadRuntime.stop('test_upload_abort');
  const aborted = await uploadingAnalysis;
  assert.equal(uploadAborted, true, 'STOP must abort an HTTP frame upload already in progress');
  assert.equal(aborted.code, 'VISION_CAPTURE_CANCELLED');
  await uploadRuntime.close();
  console.log('Vision runtime tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
