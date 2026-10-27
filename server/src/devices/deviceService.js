const { createPairingCode } = require('./deviceCredentials');
const { permissionError } = require('../userPermissionBoundary');

const PAIRING_TTL_MS = 10 * 60 * 1000;

function normalizeDeviceName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100) throw new Error('device name is invalid');
  return name;
}

class DeviceService {
  constructor(options) {
    this.repository = options.repository;
    this.accessService = options.accessService || null;
    this.now = options.now || (() => new Date());
  }

  async beginPairing({ userId, deviceName, db = null }) {
    if (this.accessService && !await this.accessService.allows(userId, 'devices')) throw permissionError();
    const code = createPairingCode();
    const expiresAt = new Date(this.now().getTime() + PAIRING_TTL_MS);
    const pairing = await this.repository.createPairingCode({
      userId,
      code,
      deviceName: normalizeDeviceName(deviceName),
      expiresAt,
      db,
    });
    return { pairingId: pairing.id, code, expiresAt };
  }

  async claimPairing({ code, capabilities }) {
    const device = await this.repository.claimPairingCode({ code, capabilities });
    if (!device || !this.accessService) return device;
    try {
      if (!await this.accessService.allows(device.user_id, 'devices')) throw permissionError();
      return device;
    } catch (error) {
      // The atomic repository claim resolves the owner. If rights changed since
      // issuance, consume the original code and revoke without returning a token.
      await this.repository.revokeForUser({ userId: device.user_id, deviceId: device.id });
      throw error;
    }
  }

  async list({ userId, db = null }) {
    return this.repository.listForUser(userId, db);
  }

  async revoke({ userId, deviceId, db = null }) {
    return this.repository.revokeForUser({ userId, deviceId, db });
  }

  async cancelPairing({ userId, pairingId, db = null }) {
    return this.repository.cancelPairingCode({ userId, pairingId, db });
  }
}

module.exports = {
  DeviceService,
  PAIRING_TTL_MS,
  normalizeDeviceName,
};
