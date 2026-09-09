const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { VisualMemoryStorage } = require('../src/vision/visualMemoryStorage');
const { VisualMemoryService, isVisualMemoryQuery, searchableTokens } = require('../src/vision/visualMemoryService');

test('visual memory encrypts authenticated image and observation data and detects tampering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vision-'));
  const key = crypto.randomBytes(32);
  const storage = new VisualMemoryStorage({ root, key });
  const blobKey = storage.createBlobKey('11111111-1111-4111-8111-111111111111');
  const metadata = { userId: 'owner-a', frameId: 'frame-a', sourceId: 'camera-a' };
  await storage.write(blobKey, { image: 'secret-image', observation: { sceneSummary: 'desk' } }, metadata);
  const raw = await fs.readFile(storage.pathFor(blobKey));
  assert.equal(raw.includes(Buffer.from('secret-image')), false);
  assert.equal((await storage.read(blobKey, metadata)).image, 'secret-image');
  await assert.rejects(storage.read(blobKey, { ...metadata, userId: 'owner-b' }));
  raw[raw.length - 1] ^= 1;
  await fs.writeFile(storage.pathFor(blobKey), raw);
  await assert.rejects(storage.read(blobKey, metadata));
  await fs.rm(root, { recursive: true, force: true });
});

test('visual memory stores every submitted frame and withholds sensitive retention pending consent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-vision-'));
  const rows = [];
  const repository = {
    async create(input) { const row = { id: `memory-${rows.length + 1}`, ...input, blob_key: input.blobKey, frame_id: input.frameId, source_id: input.sourceId, byte_length: input.byteLength, corrected_summary: '' }; rows.push(row); return row; },
    async addTokens(input) { this.tokens = input.tokenHashes; },
    async totalStoredBytes() { return rows.reduce((sum, row) => sum + row.byteLength, 0); },
    async evictionCandidates() { return []; },
    async get({ userId, memoryId }) { return rows.find((row) => row.userId === userId && row.id === memoryId) || null; },
    async pendingForConsent({ userId, leaseId, sourceId }) { return rows.filter((row) => row.userId === userId && row.leaseId === leaseId && row.sourceId === sourceId && row.state === 'pending_sensitive_consent'); },
    async setConsent({ userId, leaseId, sourceId, allow }) { return rows.filter((row) => row.userId === userId && row.leaseId === leaseId && row.sourceId === sourceId).map((row) => { row.state = allow ? 'stored' : 'rejected'; return row; }); },
    async clearBlob(memoryId) { const row = rows.find((item) => item.id === memoryId); if (row) row.blob_key = null; },
  };
  const service = new VisualMemoryService({ repository, storage: new VisualMemoryStorage({ root, key: crypto.randomBytes(32) }) });
  const metadata = { frameId: 'frame-a', sourceId: 'camera-a', contentType: 'image/jpeg', capturedAt: '2026-09-09T10:00:00.000Z' };
  const observation = { sceneSummary: 'Password: hunter2 beside a lamp', sensitivity: 'sensitive', confidence: 0.8, texts: [{ text: 'api-secret_value_123456789', sensitive: true }] };
  const stored = await service.store({ userId: 'owner-a', deviceId: 'device-a', leaseId: 'lease-a', image: Buffer.from('frame'), metadata, observation });
  assert.equal(stored.retentionConsentRequired, true);
  assert.equal(rows[0].state, 'pending_sensitive_consent');
  const pendingPath = service.storage.pathFor(rows[0].blob_key);
  await fs.access(pendingPath);
  assert.equal(searchableTokens(observation).includes('hunter2'), false);
  assert.equal(await service.consent({ userId: 'owner-a', leaseId: 'lease-a', sourceId: 'camera-a', allow: false }), 1);
  assert.equal(rows[0].state, 'rejected');
  await assert.rejects(fs.access(pendingPath));
  await fs.rm(root, { recursive: true, force: true });
});

test('visual memory context is never attached to unrelated messages', () => {
  assert.equal(isVisualMemoryQuery('Какая сегодня погода?'), false);
  assert.equal(isVisualMemoryQuery('Помнишь, что было на экране?'), true);
});

test('expired visual blobs remain eligible for cleanup retry after a storage failure', async () => {
  const row = { id: 'memory-a', state: 'stored', blob_key: 'owner/blob.jvs' };
  let removeAttempts = 0;
  const repository = {
    async expirationCandidates() { return row.blob_key ? [row] : []; },
    async markExpired() { row.state = 'expired'; },
    async clearBlob() { row.blob_key = null; },
  };
  const storage = {
    async remove() {
      removeAttempts += 1;
      if (removeAttempts === 1) throw new Error('disk temporarily unavailable');
    },
  };
  const service = new VisualMemoryService({ repository, storage });
  await assert.rejects(service.cleanupExpired(), /temporarily unavailable/u);
  assert.equal(row.state, 'expired');
  assert.equal(row.blob_key, 'owner/blob.jvs');
  assert.equal(await service.cleanupExpired(), 1);
  assert.equal(row.blob_key, null);
  assert.equal(removeAttempts, 2);
});
