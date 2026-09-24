const { createPairingCode } = require('./deviceCredentials');

const PAIRING_TTL_MS = 10 * 60 * 1000;

function normalizeDeviceName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100) throw new Error('device name is invalid');
  return name;
}

class DeviceService {
  constructor(options) {
    this.repository = options.repository;
    this.now = options.now || (() => new Date());
  }

  async beginPairing({ userId, deviceName }) {
    const code = createPairingCode();
    const expiresAt = new Date(this.now().getTime() + PAIRING_TTL_MS);
    await this.repository.createPairingCode({
      userId,
      code,
      deviceName: normalizeDeviceName(deviceName),
      expiresAt,
    });
    return { code, expiresAt };
  }

  async claimPairing({ code, capabilities }) {
    return this.repository.claimPairingCode({ code, capabilities });
  }

  async list({ userId }) {
    return this.repository.listForUser(userId);
  }

  async revoke({ userId, deviceId }) {
    return this.repository.revokeForUser({ userId, deviceId });
  }
}

module.exports = {
  DeviceService,
  PAIRING_TTL_MS,
  normalizeDeviceName,
};
