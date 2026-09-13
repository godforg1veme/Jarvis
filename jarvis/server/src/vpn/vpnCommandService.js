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
  if ((match = /^\/vpn_(revoke|rotate|export)\s+(.{1,80})$/iu.exec(value))) {
    return { kind: 'change', action: match[1].toLowerCase(), arguments: { label: match[2].trim() } };
  }
  if (/^\/vpn_restart$/i.test(value)) return { kind: 'change', action: 'restart', arguments: {} };
  if ((match = /^\/vpn_(confirm|reject)(?:\s+([a-f0-9-]{36}))?$/i.exec(value))) {
    return { kind: 'decision', decision: match[1].toLowerCase(), requestId: match[2]?.toLowerCase() || null };
  }
  if (/^\/vpn_/i.test(value)) return { kind: 'invalid' };
  return null;
}

function parseVpnCallback(value) {
  const data = String(value || '');
  if (['vpn:menu', 'vpn:status', 'vpn:clients', 'vpn:new', 'vpn:restart'].includes(data)) {
    return { action: data.slice(4) };
  }
  let match = /^vpn:(client|export|rotate|revoke):(vpn-[a-f0-9]{12})$/.exec(data);
  if (match) return { action: match[1], clientId: match[2] };
  match = /^vpn:(confirm|reject):([a-f0-9-]{36})$/i.exec(data);
  if (match) return { action: match[1], requestId: match[2].toLowerCase() };
  return null;
}

function menuButtons() {
  return [
    [{ text: '🔄 Статус', data: 'vpn:status' }, { text: '👥 Мои доступы', data: 'vpn:clients' }],
    [{ text: '➕ Новый доступ', data: 'vpn:new' }],
    [{ text: '♻️ Перезапустить VPN', data: 'vpn:restart' }],
  ];
}

function backButton() {
  return [[{ text: '← Назад', data: 'vpn:menu' }]];
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
  return `${verbs[action]} VPN-доступ «${args.label || 'выбранный'}»?`;
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
      return { answer: `VPN ${state}. Клиентов: ${Number(data.clientCount) || 0}. Конфигурация: ${data.configValid ? 'OK' : 'ошибка'}, порт 443: ${data.listenerReady ? 'слушает' : 'не слушает'}.`, buttons: menuButtons() };
    }
    const clients = await this._clients();
    return {
      answer: clients.length ? `VPN-доступы: ${clients.length}. Выбери нужный:` : 'VPN-доступов пока нет.',
      buttons: [
        ...clients.map((client) => [{ text: String(client.label || '').slice(0, 40), data: `vpn:client:${client.id}` }]),
        ...backButton(),
      ],
    };
  }

  async _clients() {
    const response = await this._request('vpn.clients.list', {});
    if (response.result.state !== 'succeeded') throw publicError('VPN_CLIENTS_UNAVAILABLE');
    return (Array.isArray(response.result.data?.clients) ? response.result.data.clients : [])
      .filter((client) => CLIENT_ID_RE.test(String(client.id || '')) && LABEL_RE.test(String(client.label || '')))
      .slice(0, 50);
  }

  async _resolveClient(label) {
    const normalized = String(label || '').trim();
    if (!LABEL_RE.test(normalized) || normalized.includes('..')) throw publicError('VPN_LABEL_INVALID');
    const matches = (await this._clients()).filter((client) => String(client.label).localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0);
    if (matches.length !== 1) throw publicError(matches.length ? 'VPN_CLIENT_LABEL_AMBIGUOUS' : 'VPN_CLIENT_NOT_FOUND');
    return matches[0];
  }

  async _create(command, context) {
    let rawArgs = command.arguments;
    if (['revoke', 'rotate', 'export'].includes(command.action) && !rawArgs.clientId) {
      const client = await this._resolveClient(rawArgs.label);
      rawArgs = { clientId: client.id };
    }
    const args = validateAction(command.action, rawArgs);
    const id = crypto.randomUUID();
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ action: command.action, args })).digest();
    const record = await this.repository.create({
      id, userId: context.userId, conversationId: context.conversationId,
      originChannel: context.originChannel, originDeviceId: context.originDeviceId || null,
      action: command.action, arguments: args, fingerprint,
      expiresAt: new Date(this.now().getTime() + CONFIRMATION_TTL_MS),
    });
    return {
      answer: actionPrompt(command.action, command.arguments?.label ? { ...args, label: command.arguments.label } : args),
      buttons: [[
        { text: '✅ Подтвердить', data: `vpn:confirm:${record.id}` },
        { text: '✖️ Отмена', data: `vpn:reject:${record.id}` },
      ]],
    };
  }

  async _decide(command, context) {
    let requestId = command.requestId;
    if (!requestId && typeof this.repository.latestPending === 'function') {
      const pending = await this.repository.latestPending({
        userId: context.userId,
        originChannel: context.originChannel,
        originDeviceId: context.originDeviceId || null,
      });
      requestId = pending?.id || null;
    }
    if (!REQUEST_ID_RE.test(String(requestId || ''))) throw publicError('VPN_CONFIRMATION_UNAVAILABLE');
    if (command.decision === 'reject') {
      const rejected = await this.repository.reject({ userId: context.userId, requestId, originChannel: context.originChannel, originDeviceId: context.originDeviceId || null });
      if (!rejected) throw publicError('VPN_CONFIRMATION_UNAVAILABLE');
      await this.repository.audit({ userId: context.userId, requestId: rejected.id, type: 'vpn.action.rejected', metadata: { action: rejected.action } });
      return { answer: 'VPN-действие отменено.', buttons: menuButtons() };
    }
    const record = await this.repository.approve({ userId: context.userId, requestId, originChannel: context.originChannel, originDeviceId: context.originDeviceId || null });
    if (!record) throw publicError('VPN_CONFIRMATION_UNAVAILABLE');
    const operation = hostOperation(record.action);
    let response;
    try {
      response = await this._request(operation, record.arguments || {}, record.id);
    } catch (_) {
      await this.repository.complete({ requestId: record.id, status: 'unknown', errorCode: 'HOST_AGENT_UNREACHABLE' });
      return { answer: 'Результат VPN-действия пока неизвестен; повторно оно не запущено.', buttons: menuButtons() };
    }
    const success = response.result.state === 'succeeded';
    const metadata = safeHostData(response.result.data || {});
    await this.repository.complete({ requestId: record.id, status: success ? 'succeeded' : response.result.state === 'unknown' ? 'unknown' : 'failed', result: metadata, errorCode: response.result.errorCode || null });
    await this.repository.audit({ userId: context.userId, requestId: record.id, type: success ? 'vpn.action.succeeded' : 'vpn.action.failed', metadata: { action: record.action, errorCode: response.result.errorCode || null } });
    if (!success) return { answer: `VPN-действие не выполнено: ${response.result.errorCode || 'неизвестный результат'}.`, buttons: menuButtons() };
    const artifact = artifactFrom(response.result.data);
    const labels = {
      issue: 'VPN-доступ создан. Файл для импорта в Happ приложен.',
      revoke: 'VPN-доступ отозван.',
      rotate: 'VPN-доступ перевыпущен. Старый ключ больше не работает; новый файл приложен.',
      export: 'Файл для импорта VPN в Happ подготовлен.',
      restart: 'Xray VPN перезапущен.',
    };
    return { answer: labels[record.action], ...(artifact ? { artifact } : {}), buttons: menuButtons() };
  }

  async handleCallback(context) {
    const callback = parseVpnCallback(context.data);
    if (!callback) return null;
    await this._requireOwner(context.userId);
    if (callback.action === 'menu') return { answer: 'Управление VPN:', buttons: menuButtons() };
    if (callback.action === 'status') return this._read({ action: 'status' });
    if (callback.action === 'clients') return this._read({ action: 'clients' });
    if (callback.action === 'new') return { answer: 'Напиши имя нового доступа командой: /vpn_issue Имя', buttons: backButton() };
    if (callback.action === 'restart') return this._create({ action: 'restart', arguments: {} }, context);
    if (callback.action === 'client') {
      const client = (await this._clients()).find((item) => item.id === callback.clientId);
      if (!client) throw publicError('VPN_CLIENT_NOT_FOUND');
      return {
        answer: `VPN-доступ «${client.label}». Выбери действие:`,
        buttons: [
          [{ text: '📄 Получить конфиг', data: `vpn:export:${client.id}` }],
          [{ text: '🔁 Перевыпустить', data: `vpn:rotate:${client.id}` }, { text: '🗑 Отозвать', data: `vpn:revoke:${client.id}` }],
          [{ text: '← К доступам', data: 'vpn:clients' }],
        ],
      };
    }
    if (['export', 'rotate', 'revoke'].includes(callback.action)) {
      const client = (await this._clients()).find((item) => item.id === callback.clientId);
      if (!client) throw publicError('VPN_CLIENT_NOT_FOUND');
      return this._create({ action: callback.action, arguments: { clientId: client.id, label: client.label } }, context);
    }
    return this._decide({ decision: callback.action, requestId: callback.requestId }, context);
  }

  async handle(context) {
    const command = parseVpnCommand(context.text);
    if (!command) return null;
    await this._requireOwner(context.userId);
    if (command.kind === 'invalid') return { answer: 'Открой /vpn и используй кнопки. Для нового доступа: /vpn_issue Имя.', buttons: menuButtons() };
    if (command.kind === 'read') return this._read(command);
    if (command.kind === 'change') return this._create(command, context);
    return this._decide(command, context);
  }
}

module.exports = { CONFIRMATION_TTL_MS, VpnCommandService, artifactFrom, menuButtons, parseVpnCallback, parseVpnCommand, safeHostData, validateAction };
