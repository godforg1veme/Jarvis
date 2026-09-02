const { validateActionArgs, validateCommandResult } = require('../commands/commandSchemas');

const PROTOCOL_VERSION = 1;
const MESSAGE_TYPES = new Set([
  'device.hello',
  'device.capabilities',
  'device.heartbeat',
  'device.welcome',
  'command.execute',
  'command.cancel',
  'command.result',
  'workflow.update',
  'server.error',
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

function validateRemoteMessage(input) {
  if (!isRecord(input)) throw new Error('remote message must be an object');
  if (input.version !== PROTOCOL_VERSION) throw new Error('unsupported remote protocol version');
  const type = String(input.type || '').trim();
  if (!MESSAGE_TYPES.has(type)) throw new Error(`unknown remote message type: ${type}`);
  const payload = input.payload === undefined ? {} : input.payload;
  if (!isRecord(payload)) throw new Error('remote message payload must be an object');
  const message = { version: PROTOCOL_VERSION, type, payload: { ...payload } };
  if (input.id !== undefined) message.id = requiredId(input.id, 'message id');

  if (type === 'device.hello') {
    message.payload.deviceId = requiredId(payload.deviceId, 'device id');
    message.payload.token = optionalText(payload.token, 512, 'device token');
    if (!message.payload.token) throw new Error('device token is required');
    message.payload.name = optionalText(payload.name, 100, 'device name');
  }
  if (type === 'device.capabilities') {
    if (!Array.isArray(payload.actions) || payload.actions.length > 100) throw new Error('capability actions are invalid');
    message.payload.actions = payload.actions.map((action) => requiredId(action, 'capability action'));
  }
  if (type === 'command.execute') {
    message.payload.commandId = requiredId(payload.commandId, 'command id');
    message.payload.action = requiredId(payload.action, 'tool action');
    message.payload.args = validateActionArgs(message.payload.action, payload.args || {});
    message.payload.confirmed = payload.confirmed === true;
    message.payload.strongConfirmed = payload.strongConfirmed === true;
  }
  if (type === 'command.cancel' || type === 'command.result') {
    message.payload.commandId = requiredId(payload.commandId, 'command id');
  }
  if (type === 'workflow.update') {
    message.payload.workflowId = requiredId(payload.workflowId, 'workflow id');
    message.payload.status = requiredId(payload.status, 'workflow status');
    message.payload.answer = optionalText(payload.answer, 10000, 'workflow answer');
    if (!message.payload.answer) throw new Error('workflow answer is required');
  }
  if (type === 'command.result') message.payload.result = validateCommandResult(payload.result);
  if (type === 'server.error') {
    message.payload.code = requiredId(payload.code, 'error code');
    message.payload.message = optionalText(payload.message, 500, 'error message');
  }
  return message;
}

function createRemoteMessage(type, payload = {}, options = {}) {
  return validateRemoteMessage({ version: PROTOCOL_VERSION, type, payload, ...(options.id ? { id: options.id } : {}) });
}

module.exports = { MESSAGE_TYPES, PROTOCOL_VERSION, createRemoteMessage, validateRemoteMessage };
