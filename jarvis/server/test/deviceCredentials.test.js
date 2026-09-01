const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createDeviceToken,
  createPairingCode,
  deviceTokenHash,
  isDeviceToken,
  normalizePairingCode,
  pairingCodeHash,
} = require('../src/devices/deviceCredentials');
const { readBearerToken } = require('../src/devices/deviceAuth');

test('pairing codes normalize without retaining their display punctuation', () => {
  const code = createPairingCode();
  const normalized = normalizePairingCode(code.toLowerCase());
  assert.match(normalized, /^[A-F0-9]{16}$/);
  assert.deepEqual(pairingCodeHash(code), pairingCodeHash(normalized));
});

test('device tokens are opaque, bounded, and hashed before persistence', () => {
  const token = createDeviceToken();
  assert.equal(isDeviceToken(token), true);
  assert.equal(deviceTokenHash(token).length, 32);
  assert.notEqual(deviceTokenHash(token).toString('hex'), token);
});

test('bearer parsing rejects malformed device credentials', () => {
  const token = createDeviceToken();
  assert.equal(readBearerToken({ authorization: `Bearer ${token}` }), token);
  assert.throws(() => readBearerToken({ authorization: 'Bearer too-short' }), /authentication failed/);
  assert.throws(() => readBearerToken({}), /authentication failed/);
});
