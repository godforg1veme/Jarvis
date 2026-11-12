const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspacePendingStore, FILE_NAME } = require('./workspacePendingStore');

const serverUrl = 'https://example.test';
const deviceId = '11111111-1111-4111-8111-111111111111';
const otherDevice = '22222222-2222-4222-8222-222222222222';
const firstId = '33333333-3333-4333-8333-333333333333';
const nextId = '44444444-4444-4444-8444-444444444444';

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-workspace-pending-'));
  try { return run(dir, new WorkspacePendingStore(dir)); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('pending UUID survives restart and never stores content or credentials', () => withStore((dir, store) => {
  store.claim(serverUrl, deviceId, 'memory', firstId);
  store.claim(serverUrl, deviceId, 'memory', firstId);
  const raw = fs.readFileSync(path.join(dir, FILE_NAME), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(raw).entries[0]).sort(), ['deviceId', 'id', 'kind', 'serverUrl']);
  assert.equal(raw.includes('secret content'), false);
  assert.deepEqual(new WorkspacePendingStore(dir).list(serverUrl, deviceId), [{ kind: 'memory', id: firstId }]);
  assert.deepEqual(store.list(serverUrl, otherDevice), []);
  assert.deepEqual(store.list('https://other.test', deviceId), []);
  assert.throws(() => store.claim(serverUrl, deviceId, 'memory', nextId),
    (error) => error.code === 'PENDING_OPERATION_EXISTS' && error.pendingId === firstId);
  assert.deepEqual(store.list(serverUrl, deviceId), [{ kind: 'memory', id: firstId }]);
  store.settle(serverUrl, otherDevice, 'memory', firstId);
  store.settle(serverUrl, deviceId, 'memory', nextId);
  assert.equal(store.list(serverUrl, deviceId).length, 1);
  store.settle(serverUrl, deviceId, 'memory', firstId);
  assert.deepEqual(new WorkspacePendingStore(dir).list(serverUrl, deviceId), []);
}));

test('other kinds have separate pending IDs within the same device', () => withStore((_dir, store) => {
  store.claim(serverUrl, deviceId, 'memory', firstId);
  store.claim(serverUrl, deviceId, 'personal-documents', nextId);
  assert.deepEqual(store.list(serverUrl, deviceId), [
    { kind: 'memory', id: firstId }, { kind: 'personal-documents', id: nextId },
  ]);
  assert.throws(() => store.claim(serverUrl, deviceId, 'arbitrary', nextId), { code: 'INVALID_WORKSPACE_OPERATION' });
  assert.throws(() => store.claim('https://user:pass@example.test', deviceId, 'memory', nextId),
    { code: 'INVALID_WORKSPACE_OPERATION' });
}));

test('corrupt or externally changed file blocks reads and new claims', () => withStore((dir, store) => {
  store.claim(serverUrl, deviceId, 'memory', firstId);
  const file = path.join(dir, FILE_NAME);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => store.list(serverUrl, deviceId), { code: 'WORKSPACE_PENDING_STORE_UNAVAILABLE' });
  assert.throws(() => store.claim(serverUrl, deviceId, 'memory', firstId),
    { code: 'WORKSPACE_PENDING_STORE_UNAVAILABLE' });
  assert.throws(() => new WorkspacePendingStore(dir).list(serverUrl, deviceId),
    { code: 'WORKSPACE_PENDING_STORE_UNAVAILABLE' });
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
}));

test('atomic write failure leaves original pending ID durable and blocks further changes', (t) => withStore((dir, store) => {
  store.claim(serverUrl, deviceId, 'memory', firstId);
  const file = path.join(dir, FILE_NAME);
  const before = fs.readFileSync(file, 'utf8');
  const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('disk unavailable'); });
  assert.throws(() => store.claim(serverUrl, deviceId, 'job-resumes', nextId),
    { code: 'WORKSPACE_PENDING_STORE_UNAVAILABLE' });
  rename.mock.restore();
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.throws(() => store.claim(serverUrl, deviceId, 'memory', firstId),
    { code: 'WORKSPACE_PENDING_STORE_UNAVAILABLE' });
  assert.deepEqual(new WorkspacePendingStore(dir).list(serverUrl, deviceId), [{ kind: 'memory', id: firstId }]);
}));
