const { validateRemoteMessage } = require('./remoteProtocol');

const PROTOCOL_VERSION = 1;
const SESSION_TYPES = new Set([
  'device.hello',
  'device.capabilities',
  'device.heartbeat',
  'command.result',
]);

function validateDeviceSessionMessage(input) {
  const message = validateRemoteMessage(input);
  if (!SESSION_TYPES.has(message.type)) throw new Error('unsupported device session message');
  return message;
}

module.exports = { PROTOCOL_VERSION, SESSION_TYPES, validateDeviceSessionMessage };
