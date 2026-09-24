const assert = require('node:assert/strict');
const { VisionTransport } = require('../vision/visionTransport');

(async () => {
  const calls = [];
  const cloudClient = {
    async createVisionLease(input) { calls.push(['lease', input]); return { lease: { leaseId: 'lease-a' } }; },
    async createVisionCaptureRequest(id, input) { calls.push(['request', id, input]); return { request: { captureRequestId: 'request-a' } }; },
    async sendVisionFrame(id, metadata, image) { calls.push(['frame', id, metadata, image.length]); return { observation: { version: 1, frameId: metadata.frameId, sourceId: metadata.sourceId, capturedAt: metadata.capturedAt, observedAt: metadata.capturedAt, sceneSummary: 'ok', sensitivity: 'none', confidence: 1, objects: [], texts: [], events: [] } }; },
    async stopVisionLease(id) { calls.push(['stop', id]); return { ok: true }; },
    async setVisionSensitiveConsent(id, sourceId, allow) { calls.push(['consent', id, sourceId, allow]); return { ok: true }; },
  };
  const transport = new VisionTransport({ cloudClient });
  await transport.createLease({ sources: [] });
  await transport.requestCapture('lease-a', { sourceId: 'camera-a', mode: 'focused' });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const metadata = { version: 1, leaseId: 'lease-a', captureRequestId: 'request-a', frameId: 'frame-a', sourceId: 'camera-a', sequence: 1, capturedAt: '2026-09-09T10:00:00.000Z', mode: 'focused', contentType: 'image/jpeg', byteLength: bytes.length, width: 1, height: 1 };
  assert.equal((await transport.uploadFrame('lease-a', metadata, bytes)).observation.sceneSummary, 'ok');
  await assert.rejects(transport.uploadFrame('wrong', metadata, bytes));
  await transport.stopLease('lease-a');
  await transport.setSensitiveConsent('lease-a', 'camera-a', true);
  assert.deepEqual(calls.map((call) => call[0]), ['lease', 'request', 'frame', 'stop', 'consent']);
  console.log('Vision transport tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
