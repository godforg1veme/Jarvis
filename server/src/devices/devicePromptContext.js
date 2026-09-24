const DEVICE_STATUSES = new Set(['online', 'offline', 'revoked']);

function normalizeDevicePromptContext(devices, limit = 20) {
  if (!Array.isArray(devices)) return [];
  return devices
    .filter((device) => device && typeof device.name === 'string')
    .slice(0, limit)
    .map((device) => {
      const name = device.name.trim().replace(/\s+/g, ' ').slice(0, 100);
      const status = DEVICE_STATUSES.has(device.status) ? device.status : 'offline';
      return { name, status };
    })
    .filter((device) => device.name);
}

module.exports = {
  DEVICE_STATUSES,
  normalizeDevicePromptContext,
};
