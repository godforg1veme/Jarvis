const { createPairingCode, pairingCodeHash } = require('../../devices/deviceCredentials');

class ConnectionAdminService {
  constructor(repository, options = {}) { this.repository = repository; this.onDeviceRevoked = options.onDeviceRevoked || (() => {}); }

  async listConnections() {
    const [profiles, identities, devices] = await Promise.all([
      this.repository.listProfiles(),
      this.repository.listTelegramIdentities(),
      this.repository.listDevices(),
    ]);
    const byProfile = new Map(profiles.map((profile) => [profile.id, {
      id: profile.id,
      displayName: profile.display_name,
      role: profile.role,
      createdAt: profile.created_at,
      telegram: [],
      devices: [],
    }]));
    for (const identity of identities) {
      const profile = byProfile.get(identity.user_id);
      if (profile) profile.telegram.push({ id: identity.id, externalId: identity.external_id, connectedAt: identity.created_at });
    }
    for (const device of devices) {
      const profile = byProfile.get(device.user_id);
      if (profile) profile.devices.push({
        id: device.id,
        name: device.name,
        status: device.status,
        kind: device.device_kind,
        lastSeenAt: device.last_seen_at,
        createdAt: device.created_at,
        updatedAt: device.updated_at,
      });
    }
    return Array.from(byProfile.values());
  }
  async reassignTelegram(input) { return this.repository.reassignTelegram(input); }
  async reassignDevice(input) {
    const code = createPairingCode(); const expiresAt = new Date(Date.now() + (10 * 60 * 1000));
    const result = await this.repository.beginDeviceReassignment({ ...input, codeHash: pairingCodeHash(code), expiresAt });
    if (result) await this.onDeviceRevoked(input.deviceId);
    return result ? { ...result, code } : null;
  }
}

module.exports = { ConnectionAdminService };
