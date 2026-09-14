const { validateActionArgs } = require('./toolSchemas');

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
  'life.proposal',
  'life.reminder',
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
    if (!Array.isArray(payload.actions) || payload.actions.length > 100) {
      throw new Error('capability actions must be an array with at most 100 items');
    }
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
  if (type === 'life.proposal') {
    message.payload.proposalId = requiredId(payload.proposalId, 'proposal id');
    message.payload.title = optionalText(payload.title, 300, 'proposal title');
    message.payload.explanation = optionalText(payload.explanation, 1000, 'proposal explanation');
    message.payload.risk = ['safe', 'changing'].includes(payload.risk) ? payload.risk : 'safe';
    if (!message.payload.title) throw new Error('proposal title is required');
  }
  if (type === 'life.reminder') {
    message.payload = {
      reminderId: requiredId(payload.reminderId, 'reminder id'),
      title: optionalText(payload.title, 300, 'reminder title'),
    };
    if (!message.payload.title) throw new Error('reminder title is required');
  }
  if (type === 'command.result' && !isRecord(payload.result)) {
    throw new Error('command result must be an object');
  }

  if (type === 'server.error') {
    message.payload.code = requiredId(payload.code, 'error code');
    message.payload.message = optionalText(payload.message, 500, 'error message');
  }

  return message;
}

function createRemoteMessage(type, payload = {}, options = {}) {
  return validateRemoteMessage({
    version: PROTOCOL_VERSION,
    type,
    payload,
    ...(options.id ? { id: options.id } : {}),
  });
}

module.exports = {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  createRemoteMessage,
  validateRemoteMessage,
};
