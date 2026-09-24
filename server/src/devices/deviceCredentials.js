const crypto = require('crypto');

const DEVICE_TOKEN_BYTES = 32;
const PAIRING_CODE_BYTES = 8;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function createDeviceToken() {
  return crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

function isDeviceToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function createPairingCode() {
  const raw = crypto.randomBytes(PAIRING_CODE_BYTES).toString('hex').toUpperCase();
  return `JARVIS-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

function normalizePairingCode(value) {
  const display = String(value || '').toUpperCase().trim().replace(/^JARVIS[-\s]*/u, '');
  const normalized = display.replace(/[^A-F0-9]/g, '');
  if (!/^[A-F0-9]{16}$/.test(normalized)) throw new Error('pairing code is invalid');
  return normalized;
}

function pairingCodeHash(value) {
  return sha256(normalizePairingCode(value));
}

function deviceTokenHash(value) {
  const token = String(value || '');
  if (!isDeviceToken(token)) throw new Error('device token is invalid');
  return sha256(token);
}

module.exports = {
  DEVICE_TOKEN_BYTES,
  PAIRING_CODE_BYTES,
  createDeviceToken,
  createPairingCode,
  deviceTokenHash,
  isDeviceToken,
  normalizePairingCode,
  pairingCodeHash,
  sha256,
};
