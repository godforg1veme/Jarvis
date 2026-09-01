const PROTOCOL_VERSION = 1;
const SESSION_TYPES = new Set([
  'device.hello',
  'device.capabilities',
  'device.heartbeat',
]);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredId(value, label) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) throw new Error(`${label} is invalid`);
  return id;
}

function optionalText(value, maxLength, label) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(`${label} is too long`);
  return text;
}

function validateDeviceSessionMessage(input) {
  if (!isRecord(input)) throw new Error('device session message must be an object');
  if (input.version !== PROTOCOL_VERSION) throw new Error('unsupported remote protocol version');

  const type = String(input.type || '').trim();
  if (!SESSION_TYPES.has(type)) throw new Error('unsupported device session message');
  const payload = input.payload === undefined ? {} : input.payload;
  if (!isRecord(payload)) throw new Error('device session payload must be an object');

  const message = { version: PROTOCOL_VERSION, type, payload: { ...payload } };
  if (type === 'device.hello') {
    message.payload.deviceId = requiredId(payload.deviceId, 'device id');
    message.payload.token = optionalText(payload.token, 512, 'device token');
    if (!message.payload.token) throw new Error('device token is required');
    message.payload.name = optionalText(payload.name, 100, 'device name');
  }

  if (type === 'device.capabilities') {
    if (!Array.isArray(payload.actions) || payload.actions.length > 100) {
      throw new Error('capability actions must be an array with at most 100 items');
    }
    message.payload.actions = payload.actions.map((action) => requiredId(action, 'capability action'));
  }

  return message;
}

module.exports = { PROTOCOL_VERSION, SESSION_TYPES, validateDeviceSessionMessage };
