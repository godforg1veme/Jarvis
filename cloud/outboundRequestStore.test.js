const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OutboundRequestStore, FILE_NAME } = require('./outboundRequestStore');

const entry = { clientMessageId: '12345678-1234-4234-8234-123456789abc', kind: 'text',
  createdAt: '2026-10-20T00:00:00.000Z', serverUrl: 'https://example.test', deviceId: 'device-a' };

test('persists metadata only across restart and keeps scope and original ID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-outbound-'));
  try {
    new OutboundRequestStore(dir).claim(entry);
    const raw = fs.readFileSync(path.join(dir, FILE_NAME), 'utf8');
    assert.equal(raw.includes('secret payload'), false);
    const restarted = new OutboundRequestStore(dir);
    assert.deepEqual(restarted.list(entry.serverUrl, entry.deviceId),
      [{ clientMessageId: entry.clientMessageId, kind: 'text', createdAt: entry.createdAt }]);
    assert.deepEqual(restarted.list(entry.serverUrl, 'other-device'), []);
    assert.throws(() => restarted.claim(entry), /REQUEST_ID_ALREADY_CLAIMED/);
    assert.throws(() => restarted.acknowledge(entry.clientMessageId, entry.serverUrl, 'other-device'), /REQUEST_NOT_FOUND/);
    restarted.acknowledge(entry.clientMessageId, entry.serverUrl, entry.deviceId);
    assert.deepEqual(new OutboundRequestStore(dir).list(entry.serverUrl, entry.deviceId), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt store and atomic write failure block claims without discarding evidence', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-outbound-'));
  try {
    const file = path.join(dir, FILE_NAME);
    fs.writeFileSync(file, '{broken');
    const corrupt = new OutboundRequestStore(dir);
    assert.throws(() => corrupt.claim(entry), /OUTBOUND_STORE_UNAVAILABLE/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
    fs.unlinkSync(file);
    const store = new OutboundRequestStore(dir);
    const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('disk failed'); });
    assert.throws(() => store.claim(entry), /OUTBOUND_STORE_UNAVAILABLE/);
    rename.mock.restore();
    assert.equal(fs.existsSync(file), false);
    assert.throws(() => store.claim(entry), /OUTBOUND_STORE_UNAVAILABLE/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed delivery acknowledgement preserves readable claim and durable evidence', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-outbound-'));
  try {
    const store = new OutboundRequestStore(dir);
    store.claim(entry);
    const original = fs.readFileSync(path.join(dir, FILE_NAME), 'utf8');
    const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('disk failed'); });
    assert.throws(() => store.acknowledge(entry.clientMessageId, entry.serverUrl, entry.deviceId), /OUTBOUND_STORE_UNAVAILABLE/);
    rename.mock.restore();
    assert.equal(store.list(entry.serverUrl, entry.deviceId)[0].clientMessageId, entry.clientMessageId);
    assert.equal(fs.readFileSync(path.join(dir, FILE_NAME), 'utf8'), original);
    assert.equal(new OutboundRequestStore(dir).list(entry.serverUrl, entry.deviceId).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
