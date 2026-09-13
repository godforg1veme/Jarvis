const crypto = require('node:crypto');

const CONFIRMATION_TTL_MS = 60 * 1000;
const REQUEST_ID_RE = /^[a-f0-9-]{36}$/i;
const CLIENT_ID_RE = /^vpn-[a-f0-9]{12}$/;
const LABEL_RE = /^[A-Za-zА-Яа-яЁё0-9_. -]{1,40}$/;

function publicError(code) {
  const error = new Error(code);
  error.publicCode = code;
  return error;
}

function parseVpnCommand(text) {
  const value = String(text || '').trim();
  let match;
  if (/^\/vpn(?:_status)?$/i.test(value)) return { kind: 'read', action: 'status', arguments: {} };
  if (/^\/vpn_clients$/i.test(value)) return { kind: 'read', action: 'clients', arguments: {} };
  if ((match = /^\/vpn_issue\s+(.{1,80})$/iu.exec(value))) return { kind: 'change', action: 'issue', arguments: { label: match[1].trim() } };
  if ((match = /^\/vpn_(revoke|rotate|export)\s+(vpn-[a-f0-9]{12})$/i.exec(value))) {
    return { kind: 'change', action: match[1].toLowerCase(), arguments: { clientId: match[2].toLowerCase() } };
  }
  if (/^\/vpn_restart$/i.test(value)) return { kind: 'change', action: 'restart', arguments: {} };
  if ((match = /^\/vpn_(confirm|reject)\s+([a-f0-9-]{36})$/i.exec(value))) {
    return { kind: 'decision', decision: match[1].toLowerCase(), requestId: match[2].toLowerCase() };
  }
  if (/^\/vpn_/i.test(value)) return { kind: 'invalid' };
  return null;
}

function validateAction(action, args) {
  if (action === 'issue') {
    const label = String(args?.label || '').trim();
    if (!LABEL_RE.test(label) || label.includes('..')) throw publicError('VPN_LABEL_INVALID');
    return { label };
  }
  if (['revoke', 'rotate', 'export'].includes(action)) {
    const clientId = String(args?.clientId || '').toLowerCase();
    if (!CLIENT_ID_RE.test(clientId)) throw publicError('VPN_CLIENT_ID_INVALID');
    return { clientId };
  }
  if (action === 'restart') return {};
  throw publicError('VPN_ACTION_INVALID');
}

function safeHostData(data = {}) {
  const client = data.client && CLIENT_ID_RE.test(String(data.client.id || '')) ? {
    id: data.client.id,
    label: String(data.client.label || '').slice(0, 40),
    createdAt: String(data.client.createdAt || '').slice(0, 40),
  } : null;
  return {
    ...(client ? { client } : {}),
    ...(Number.isInteger(data.clientCount) ? { clientCount: Math.min(Math.max(data.clientCount, 0), 50) } : {}),
  };
}

function artifactFrom(data) {
  const uri = String(data?.shareUri || '');
  const client = data?.client;
  if (!uri.startsWith('vless://') || uri.length > 4096 || !client || !CLIENT_ID_RE.test(String(client.id || ''))) return null;
  const safeLabel = String(client.label || 'happ').replace(/[^A-Za-zА-Яа-яЁё0-9_. -]/g, '').trim().slice(0, 30) || 'happ';
  return {
    kind: 'happ-vless',
    filename: `${safeLabel}-${client.id}.txt`,
    content: `${uri}\n`,
  };
}

function actionPrompt(action, args) {
  if (action === 'issue') return `Создать новый VPN-доступ «${args.label}»?`;
  if (action === 'restart') return 'Перезапустить Xray VPN? Активные соединения кратковременно прервутся.';
  const verbs = { revoke: 'Отозвать', rotate: 'Перевыпустить', export: 'Экспортировать' };
  return `${verbs[action]} VPN-доступ ${args.clientId}?`;
}

function hostOperation(action) {
  return {
    issue: 'vpn.client.issue', revoke: 'vpn.client.revoke', rotate: 'vpn.client.rotate',
    export: 'vpn.client.export', restart: 'vpn.restart',
  }[action];
}

class VpnCommandService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.client = options.client;
    this.ownerTelegramId = String(options.ownerTelegramId || '');
    this.now = options.now || (() => new Date());
  }

  async _requireOwner(userId) {
    if (!await this.repository.isOwner({ userId, ownerTelegramId: this.ownerTelegramId })) throw publicError('VPN_OWNER_REQUIRED');
  }

  async _request(operation, args, requestId = crypto.randomUUID()) {
    return this.client.request({ version: 1, requestId, operation, arguments: args, sentAt: this.now().toISOString() });
  }

  async _read(command) {
    if (command.action === 'status') {
      const response = await this._request('vpn.status', {});
      if (response.result.state !== 'succeeded') return { answer: 'VPN недоступен для диагностики.' };
      const data = response.result.data || {};
      const state = data.serviceState === 'active' && data.configValid && data.listenerReady ? 'работает' : 'требует внимания';
      return { answer: `VPN ${state}. Клиентов: ${Number(data.clientCount) || 0}. Конфигурация: ${data.configValid ? 'OK' : 'ошибка'}, порт 443: ${data.listenerReady ? 'слушает' : 'не слушает'}.` };
    }
    const response = await this._request('vpn.clients.list', {});
    if (response.result.state !== 'succeeded') return { answer: 'Не удалось получить список VPN-клиентов.' };
    const clients = Array.isArray(response.result.data?.clients) ? response.result.data.clients.slice(0, 50) : [];
    return { answer: clients.length ? clients.map((client) => `${String(client.label || '').slice(0, 40)} — ${client.id}`).join('\n') : 'VPN-клиентов пока нет.' };
  }

  async _create(command, context) {
    const args = validateAction(command.action, command.arguments);
    const id = crypto.randomUUID();
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ action: command.action, args })).digest();
    const record = await this.repository.create({
      id, userId: context.userId, conversationId: context.conversationId,
      originChannel: context.originChannel, originDeviceId: context.originDeviceId || null,
      action: command.action, arguments: args, fingerprint,
      expiresAt: new Date(this.now().getTime() + CONFIRMATION_TTL_MS),
    });
    return { answer: `${actionPrompt(command.action, args)}\nПодтверди: /vpn_confirm ${record.id}\nОтмена: /vpn_reject ${record.id}` };
  }

  async _decide(command, context) {
    if (!REQUEST_ID_RE.test(command.requestId)) throw publicError('VPN_CONFIRMATION_INVALID');
    if (command.decision === 'reject') {
      const rejected = await this.repository.reject({ userId: context.userId, requestId: command.requestId, originChannel: context.originChannel, originDeviceId: context.originDeviceId || null });
      if (!rejected) throw publicError('VPN_CONFIRMATION_UNAVAILABLE');
      await this.repository.audit({ userId: context.userId, requestId: rejected.id, type: 'vpn.action.rejected', metadata: { action: rejected.action } });
      return { answer: 'VPN-действие отменено.' };
    }
    const record = await this.repository.approve({ userId: context.userId, requestId: command.requestId, originChannel: context.originChannel, originDeviceId: context.originDeviceId || null });
    if (!record) throw publicError('VPN_CONFIRMATION_UNAVAILABLE');
    const operation = hostOperation(record.action);
    let response;
    try {
      response = await this._request(operation, record.arguments || {}, record.id);
    } catch (_) {
      await this.repository.complete({ requestId: record.id, status: 'unknown', errorCode: 'HOST_AGENT_UNREACHABLE' });
      return { answer: 'Результат VPN-действия пока неизвестен; повторно оно не запущено.' };
    }
    const success = response.result.state === 'succeeded';
    const metadata = safeHostData(response.result.data || {});
    await this.repository.complete({ requestId: record.id, status: success ? 'succeeded' : response.result.state === 'unknown' ? 'unknown' : 'failed', result: metadata, errorCode: response.result.errorCode || null });
    await this.repository.audit({ userId: context.userId, requestId: record.id, type: success ? 'vpn.action.succeeded' : 'vpn.action.failed', metadata: { action: record.action, errorCode: response.result.errorCode || null } });
    if (!success) return { answer: `VPN-действие не выполнено: ${response.result.errorCode || 'неизвестный результат'}.` };
    const artifact = artifactFrom(response.result.data);
    const labels = {
      issue: 'VPN-доступ создан. Файл для импорта в Happ приложен.',
      revoke: 'VPN-доступ отозван.',
      rotate: 'VPN-доступ перевыпущен. Старый ключ больше не работает; новый файл приложен.',
      export: 'Файл для импорта VPN в Happ подготовлен.',
      restart: 'Xray VPN перезапущен.',
    };
    return { answer: labels[record.action], ...(artifact ? { artifact } : {}) };
  }

  async handle(context) {
    const command = parseVpnCommand(context.text);
    if (!command) return null;
    await this._requireOwner(context.userId);
    if (command.kind === 'invalid') return { answer: 'Команда VPN некорректна. Используй /vpn, /vpn_clients, /vpn_issue ИМЯ, /vpn_revoke ID, /vpn_rotate ID, /vpn_export ID или /vpn_restart.' };
    if (command.kind === 'read') return this._read(command);
    if (command.kind === 'change') return this._create(command, context);
    return this._decide(command, context);
  }
}

module.exports = { CONFIRMATION_TTL_MS, VpnCommandService, artifactFrom, parseVpnCommand, safeHostData, validateAction };
