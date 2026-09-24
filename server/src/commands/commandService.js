const crypto = require('node:crypto');
const { createRemoteMessage } = require('../devices/remoteProtocol');
const {
  POLICY,
  validateCommandInput,
  validateCommandResult,
} = require('./commandSchemas');

const COMMAND_TTL_MS = 10 * 60 * 1000;
const CONFIRMATION_TTL_MS = 60 * 1000;

function safeValue(value, max = 500) {
  return String(value === undefined || value === null ? '' : value).replace(/[\r\n]+/g, ' ').slice(0, max);
}

const ACTION_PROMPT_TITLES = Object.freeze({
  'app.launch': 'Запустить приложение',
  'app.close': 'Закрыть приложение',
  'file.open': 'Открыть файл',
  'file.open_folder': 'Открыть папку',
  'file.reveal': 'Показать в Проводнике',
  'file.create_folder': 'Создать папку',
  'file.create_text_file': 'Создать файл',
  'file.rename': 'Переименовать файл',
  'file.move': 'Переместить файл',
  'file.copy': 'Скопировать файл',
  'file.delete': 'Удалить в корзину',
  'file.permanent_delete': 'Удалить навсегда',
  'file.move_batch': 'Переместить выбранные файлы',
  'file.copy_batch': 'Скопировать выбранные файлы',
  'file.rename_batch': 'Переименовать выбранные файлы',
  'file.delete_batch': 'Удалить выбранные файлы',
  'window.focus': 'Переключиться на окно',
  'window.restore': 'Развернуть окно',
  'window.close': 'Закрыть окно',
  'window.move': 'Переместить окно',
  'window.resize': 'Изменить размер окна',
  'window.layout': 'Применить расположение окон',
});

function commandPrompt(action, args = {}) {
  const name = safeValue(args.name || args.title || args.query || (args.appId && !/^[a-f0-9-]{36}$/i.test(args.appId) ? args.appId : ''));
  const path = safeValue(args.path || '');
  const from = safeValue(args.from || '');
  const to = safeValue(args.to || args.destination || '');
  const newName = safeValue(args.newName || '');

  if (action === 'app.launch') {
    return name ? `Запустить приложение «${name}»?` : 'Запустить выбранное приложение?';
  }
  if (action === 'app.close') {
    return name ? `Закрыть приложение «${name}»?` : 'Закрыть выбранное приложение?';
  }
  if (action === 'file.delete') {
    return path ? `Удалить в корзину: ${path}?` : 'Удалить выбранный файл в корзину?';
  }
  if (action === 'file.permanent_delete') {
    return path ? `Удалить навсегда: ${path}?` : 'Удалить выбранный файл навсегда?';
  }
  if (action === 'file.open') {
    return path ? `Открыть файл «${path}»?` : (name ? `Открыть файл «${name}»?` : 'Открыть выбранный файл?');
  }
  if (action === 'file.open_folder') {
    return path ? `Открыть папку «${path}»?` : 'Открыть выбранную папку?';
  }
  if (action === 'file.reveal') {
    return path ? `Показать в Проводнике: ${path}?` : 'Показать выбранный объект в Проводнике?';
  }
  if (action === 'file.create_folder') {
    return path ? `Создать папку «${path}»?` : 'Создать папку?';
  }
  if (action === 'file.create_text_file') {
    return path ? `Создать файл «${path}»?` : 'Создать файл?';
  }
  if (action === 'file.rename') {
    return from && newName ? `Переименовать «${from}» в «${newName}»?` : (newName ? `Переименовать в «${newName}»?` : 'Переименовать файл?');
  }
  if (action === 'file.move') {
    return from && to ? `Переместить «${from}» в «${to}»?` : (to ? `Переместить в «${to}»?` : 'Переместить файл?');
  }
  if (action === 'file.copy') {
    return from && to ? `Скопировать «${from}» в «${to}»?` : (to ? `Скопировать в «${to}»?` : 'Скопировать файл?');
  }

  const title = ACTION_PROMPT_TITLES[action];
  const details = [];
  for (const key of ['path', 'from', 'to', 'destination', 'newName', 'query']) {
    if (args && args[key] !== undefined && typeof args[key] === 'string' && args[key].trim()) {
      details.push(`${key}: ${safeValue(args[key])}`);
    }
  }
  const suffix = details.length ? ` (${details.join(', ')})` : '';
  if (title) {
    return `Подтвердить действие «${title}»${suffix}?`;
  }
  return `Подтвердить действие «${safeValue(action, 128)}»${suffix}?`;
}

function isChangingPolicy(policy) {
  return policy === POLICY.CONFIRM || policy === POLICY.STRONG;
}

function resolveTrustedPolicy(normalized, trustedPolicy) {
  if (trustedPolicy === undefined || trustedPolicy === null) return normalized.policy;
  if (trustedPolicy === normalized.policy) return normalized.policy;
  if (
    normalized.action === 'file.open' &&
    normalized.args.candidateId &&
    trustedPolicy === POLICY.LOW_RISK
  ) return POLICY.LOW_RISK;
  throw new Error('invalid trusted command policy override');
}

class CommandService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.deviceRepository = options.deviceRepository;
    this.sessionRegistry = options.sessionRegistry;
    this.resultBroker = options.resultBroker || null;
    this.now = options.now || (() => new Date());
  }

  async create(input) {
    if (!['telegram', 'pwa', 'desktop'].includes(input.originChannel)) throw this.publicError(400, 'INVALID_COMMAND_ORIGIN');
    const normalized = validateCommandInput({
      deviceId: input.deviceId,
      action: input.action,
      args: input.args || {},
    });
    const policy = resolveTrustedPolicy(normalized, input.trustedPolicy);
    const device = await this._findDevice(normalized.deviceId, input.userId);
    if (!device) throw this.publicError(404, 'DEVICE_NOT_FOUND');
    if (device.status === 'revoked') throw this.publicError(409, 'DEVICE_REVOKED');
    if (!this._supports(device, normalized.action)) throw this.publicError(409, 'ACTION_UNSUPPORTED_BY_DEVICE');

    const id = crypto.randomUUID();
    const changing = isChangingPolicy(policy);
    const expiresAt = new Date(this.now().getTime() + COMMAND_TTL_MS);
    const confirmationExpiresAt = new Date(this.now().getTime() + CONFIRMATION_TTL_MS);
    const created = await this.repository.create({
      id,
      userId: input.userId,
      deviceId: normalized.deviceId,
      conversationId: input.conversationId || null,
      originChannel: input.originChannel,
      originDeviceId: input.originDeviceId || null,
      action: normalized.action,
      args: normalized.args,
      policy,
      status: changing ? 'awaiting_confirmation' : 'queued',
      prompt: changing ? commandPrompt(normalized.action, normalized.args) : null,
      expiresAt: changing ? confirmationExpiresAt : expiresAt,
      workflowId: input.workflowId || null,
      actionRunId: input.actionRunId || null,
    });

    if (!changing) {
      return { ...await this.dispatch(created.command), confirmation: null };
    }
    return {
      command: created.command,
      confirmation: created.confirmation,
      status: 'awaiting_confirmation',
      prompt: created.confirmation && created.confirmation.prompt,
    };
  }

  async approve({ userId, commandId, originChannel, originDeviceId = null }) {
    const command = await this.repository.approve({ userId, commandId, originChannel, originDeviceId });
    if (!command) throw this.publicError(409, 'CONFIRMATION_UNAVAILABLE');
    return this.dispatch(command);
  }

  async get({ userId, commandId }) {
    const command = await this.repository.getForUser({ userId, commandId });
    if (!command) throw this.publicError(404, 'COMMAND_NOT_FOUND');
    return command;
  }

  async reject({ userId, commandId, originChannel, originDeviceId = null }) {
    const command = await this.repository.reject({ userId, commandId, originChannel, originDeviceId });
    if (!command) throw this.publicError(409, 'CONFIRMATION_UNAVAILABLE');
    await this.repository.audit({
      userId,
      deviceId: command.device_id,
      commandId,
      eventType: 'command.rejected',
      metadata: { originChannel },
    });
    return { command, status: 'cancelled' };
  }

  async cancel({ userId, commandId, originChannel, originDeviceId = null }) {
    const command = await this.repository.cancel({ userId, commandId, originChannel, originDeviceId });
    if (!command) throw this.publicError(409, 'COMMAND_UNAVAILABLE');
    await this.repository.audit({
      userId,
      deviceId: command.device_id,
      commandId,
      eventType: 'command.cancelled',
      metadata: { originChannel },
    });
    return { command, status: 'cancelled' };
  }

  async dispatch(command) {
    const running = await this.repository.markRunning({ userId: command.user_id, commandId: command.id });
    if (!running) throw this.publicError(409, 'COMMAND_NOT_QUEUED');
    const message = createRemoteMessage('command.execute', {
      commandId: running.id,
      action: running.action,
      args: running.arguments || {},
      confirmed: running.policy === POLICY.CONFIRM || running.policy === POLICY.STRONG,
      strongConfirmed: running.policy === POLICY.STRONG,
    });
    let sent = false;
    try {
      sent = this.sessionRegistry && this.sessionRegistry.send(running.device_id, message);
    } catch (_) {
      sent = false;
    }
    if (!sent) {
      const failed = await this.repository.fail({
        userId: running.user_id,
        commandId: running.id,
        errorCode: 'DEVICE_OFFLINE',
        result: { ok: false, error: 'Device is offline.' },
      });
      await this.repository.audit({
        userId: running.user_id,
        deviceId: running.device_id,
        commandId: running.id,
        eventType: 'command.delivery_failed',
        metadata: { errorCode: 'DEVICE_OFFLINE' },
      });
      if (this.resultBroker && failed) this.resultBroker.notify(failed);
      return { command: failed || running, status: 'failed', error: 'DEVICE_OFFLINE' };
    }
    await this.repository.audit({
      userId: running.user_id,
      deviceId: running.device_id,
      commandId: running.id,
      eventType: 'command.dispatched',
      metadata: { action: running.action },
    });
    return { command: running, status: 'running' };
  }

  async handleResult({ device, commandId, result }) {
    const normalized = validateCommandResult(result);
    const command = await this.repository.getForDevice({
      userId: device.user_id,
      deviceId: device.id,
      commandId,
    });
    if (!command) throw this.publicError(404, 'COMMAND_NOT_FOUND');
    if (!['queued', 'running'].includes(command.status)) return { duplicate: true, command };
    if (normalized.action && normalized.action !== command.action) {
      const failed = await this.repository.fail({
        userId: device.user_id,
        commandId,
        errorCode: 'RESULT_ACTION_MISMATCH',
        result: { ok: false, error: 'Command result action mismatch.' },
      });
      if (this.resultBroker && failed) this.resultBroker.notify(failed);
      return { command: failed, status: 'failed' };
    }
    const ok = normalized.ok === true;
    const updated = await this.repository.complete({
      userId: device.user_id,
      deviceId: device.id,
      commandId,
      result: normalized,
      ok,
      errorCode: ok ? null : normalized.executionUnknown ? 'EXECUTION_UNKNOWN'
        : /^[A-Z0-9_]{1,80}$/.test(String(normalized.errorCode || '')) ? normalized.errorCode : 'TOOL_EXECUTION_FAILED',
    });
    await this.repository.audit({
      userId: device.user_id,
      deviceId: device.id,
      commandId,
      eventType: ok ? 'command.succeeded' : 'command.failed',
      metadata: { action: command.action, executionUnknown: normalized.executionUnknown === true },
    });
    if (this.resultBroker && updated) this.resultBroker.notify(updated);
    return { command: updated, status: ok ? 'succeeded' : 'failed' };
  }

  async waitForTerminal({ userId, commandId, timeoutMs = 5000 }) {
    const load = async () => this.repository.getForUser({ userId, commandId });
    const current = await load();
    if (!current) throw this.publicError(404, 'COMMAND_NOT_FOUND');
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(current.status)) return current;
    if (!this.resultBroker) return null;
    return this.resultBroker.wait(commandId, { timeoutMs, load });
  }

  async _findDevice(deviceId, userId) {
    if (!this.deviceRepository) return null;
    const devices = await this.deviceRepository.listForUser(userId);
    return devices.find((device) => device.id === deviceId) || null;
  }

  _supports(device, action) {
    const actions = device.capabilities && Array.isArray(device.capabilities.actions)
      ? device.capabilities.actions
      : [];
    return actions.includes(action);
  }

  publicError(statusCode, publicCode) {
    const error = new Error(publicCode);
    error.statusCode = statusCode;
    error.publicCode = publicCode;
    return error;
  }
}

module.exports = {
  COMMAND_TTL_MS,
  CONFIRMATION_TTL_MS,
  CommandService,
  commandPrompt,
  isChangingPolicy,
};
