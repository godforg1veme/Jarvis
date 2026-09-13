const crypto = require('node:crypto');

const CONFIRMATION_TTL_MS = 60 * 1000;
const REQUEST_ID_RE = /^[a-f0-9-]{36}$/i;
const CLIENT_ID_RE = /^vpn-[a-f0-9]{12}$/;
const LABEL_RE = /^[A-Za-zА-Яа-яЁё0-9_. -]{1,40}$/;
const PROTOCOLS = Object.freeze({ vless: { code: 'v', title: 'VLESS' }, hysteria2: { code: 'h', title: 'Hysteria2' } });

function publicError(code) {
  const error = new Error(code);
  error.publicCode = code;
  return error;
}

function normalizeProtocol(value) {
  const protocol = String(value || 'vless').toLowerCase();
  if (!PROTOCOLS[protocol]) throw publicError('VPN_PROTOCOL_INVALID');
  return protocol;
}

function parseVpnCommand(text) {
  const value = String(text || '').trim();
  let match;
  if (/^\/vpn$/i.test(value)) return { kind: 'menu' };
  if (/^\/vpn_status$/i.test(value)) return { kind: 'read', action: 'status', protocol: 'vless', arguments: {} };
  if (/^\/vpn_clients$/i.test(value)) return { kind: 'read', action: 'clients', protocol: 'vless', arguments: {} };
  if ((match = /^\/vpn_(hysteria2|hysteria|hy2)_(status|clients)$/i.exec(value))) {
    return { kind: 'read', action: match[2].toLowerCase(), protocol: 'hysteria2', arguments: {} };
  }
  if ((match = /^\/vpn_(?:(hysteria2|hysteria|hy2)_)?issue\s+(.{1,80})$/iu.exec(value))) {
    return { kind: 'change', action: 'issue', protocol: match[1] ? 'hysteria2' : 'vless', arguments: { label: match[2].trim() } };
  }
  if ((match = /^\/vpn_(?:(hysteria2|hysteria|hy2)_)?(revoke|rotate|export)\s+(.{1,80})$/iu.exec(value))) {
    return { kind: 'change', action: match[2].toLowerCase(), protocol: match[1] ? 'hysteria2' : 'vless', arguments: { label: match[3].trim() } };
  }
  if ((match = /^\/vpn_(?:(hysteria2|hysteria|hy2)_)?restart$/i.exec(value))) {
    return { kind: 'change', action: 'restart', protocol: match[1] ? 'hysteria2' : 'vless', arguments: {} };
  }
  if ((match = /^\/vpn_(confirm|reject)(?:\s+([a-f0-9-]{36}))?$/i.exec(value))) {
    return { kind: 'decision', decision: match[1].toLowerCase(), requestId: match[2]?.toLowerCase() || null };
  }
  if (/^\/vpn_/i.test(value)) return { kind: 'invalid' };
  return null;
}

function parseVpnCallback(value) {
  const data = String(value || '');
  let match = /^vpn:p:(v|h)$/.exec(data);
  if (match) return { action: 'protocol', protocol: match[1] === 'h' ? 'hysteria2' : 'vless' };
  match = /^vpn:(v|h):(menu|status|clients|new|restart)$/.exec(data);
  if (match) return { action: match[2], protocol: match[1] === 'h' ? 'hysteria2' : 'vless' };
  match = /^vpn:(v|h):(client|export|rotate|revoke):(vpn-[a-f0-9]{12})$/.exec(data);
  if (match) return { action: match[2], protocol: match[1] === 'h' ? 'hysteria2' : 'vless', clientId: match[3] };
  if (['vpn:menu', 'vpn:status', 'vpn:clients', 'vpn:new', 'vpn:restart'].includes(data)) {
    return { action: data.slice(4), ...(data === 'vpn:menu' ? {} : { protocol: 'vless' }) };
  }
  match = /^vpn:(client|export|rotate|revoke):(vpn-[a-f0-9]{12})$/.exec(data);
  if (match) return { action: match[1], protocol: 'vless', clientId: match[2] };
  match = /^vpn:(confirm|reject):([a-f0-9-]{36})$/i.exec(data);
  if (match) return { action: match[1], requestId: match[2].toLowerCase() };
  return null;
}

function menuButtons() {
  return [
    [{ text: '⚡ Hysteria2 — рекомендуется', data: 'vpn:p:h' }],
    [{ text: '🛡 VLESS — резерв', data: 'vpn:p:v' }],
  ];
}

function protocolButtons(protocol) {
  const code = PROTOCOLS[normalizeProtocol(protocol)].code;
  return [
    [{ text: '🔄 Статус', data: `vpn:${code}:status` }, { text: '👥 Мои доступы', data: `vpn:${code}:clients` }],
    [{ text: '➕ Новый доступ', data: `vpn:${code}:new` }],
    [{ text: '♻️ Перезапустить', data: `vpn:${code}:restart` }],
    [{ text: '← Выбор протокола', data: 'vpn:menu' }],
  ];
}

function backButton(protocol) {
  const code = PROTOCOLS[normalizeProtocol(protocol)].code;
  return [[{ text: '← Назад', data: `vpn:${code}:menu` }]];
}

function validateAction(action, args) {
  const protocol = normalizeProtocol(args?.protocol);
  if (action === 'issue') {
    const label = String(args?.label || '').trim();
    if (!LABEL_RE.test(label) || label.includes('..')) throw publicError('VPN_LABEL_INVALID');
    return { protocol, label };
  }
  if (['revoke', 'rotate', 'export'].includes(action)) {
    const clientId = String(args?.clientId || '').toLowerCase();
    if (!CLIENT_ID_RE.test(clientId)) throw publicError('VPN_CLIENT_ID_INVALID');
    return { protocol, clientId };
  }
  if (action === 'restart') return { protocol };
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
  const vless = uri.startsWith('vless://');
  const hysteria2 = uri.startsWith('hy2://') || uri.startsWith('hysteria2://');
  if ((!vless && !hysteria2) || uri.length > 4096 || !client || !CLIENT_ID_RE.test(String(client.id || ''))) return null;
  const safeLabel = String(client.label || 'happ').replace(/[^A-Za-zА-Яа-яЁё0-9_. -]/g, '').trim().slice(0, 30) || 'happ';
  return {
    kind: hysteria2 ? 'happ-hysteria2' : 'happ-vless',
    filename: `${safeLabel}-${hysteria2 ? 'hysteria2' : 'vless'}.txt`,
    content: `${uri}\n`,
  };
}

function actionPrompt(action, args) {
  const title = PROTOCOLS[normalizeProtocol(args.protocol)].title;
  if (action === 'issue') return `Создать новый ${title}-доступ «${args.label}»?`;
  if (action === 'restart') return `Перезапустить ${title} VPN? Активные соединения кратковременно прервутся.`;
  const verbs = { revoke: 'Отозвать', rotate: 'Перевыпустить', export: 'Экспортировать' };
  return `${verbs[action]} ${title}-доступ «${args.label || 'выбранный'}»?`;
}

function hostOperation(action, protocol) {
  if (action === 'status') return protocol === 'hysteria2' ? 'vpn.hysteria2.status' : 'vpn.status';
  if (action === 'clients') return protocol === 'hysteria2' ? 'vpn.hysteria2.clients.list' : 'vpn.clients.list';
  const suffix = { issue: 'client.issue', revoke: 'client.revoke', rotate: 'client.rotate', export: 'client.export', restart: 'restart' }[action];
  if (!suffix) return null;
  return protocol === 'hysteria2' ? `vpn.hysteria2.${suffix}` : `vpn.${suffix}`;
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
    const protocol = normalizeProtocol(command.protocol);
    const title = PROTOCOLS[protocol].title;
    if (command.action === 'status') {
      const response = await this._request(hostOperation('status', protocol), {});
      if (response.result.state !== 'succeeded') return { answer: `${title} недоступен для диагностики.`, buttons: protocolButtons(protocol) };
      const data = response.result.data || {};
      const state = data.serviceState === 'active' && data.configValid && data.listenerReady ? 'работает' : 'требует внимания';
      return { answer: `${title} ${state}. Клиентов: ${Number(data.clientCount) || 0}. Конфигурация: ${data.configValid ? 'OK' : 'ошибка'}, порт: ${data.listenerReady ? 'слушает' : 'не слушает'}.`, buttons: protocolButtons(protocol) };
    }
    const clients = await this._clients(protocol);
    return {
      answer: clients.length ? `${title}-доступы: ${clients.length}. Выбери нужный:` : `${title}-доступов пока нет.`,
      buttons: [
        ...clients.map((client) => [{ text: String(client.label || '').slice(0, 40), data: `vpn:${PROTOCOLS[protocol].code}:client:${client.id}` }]),
        ...backButton(protocol),
      ],
    };
  }

  async _clients(protocol) {
    const response = await this._request(hostOperation('clients', protocol), {});
    if (response.result.state !== 'succeeded') throw publicError('VPN_CLIENTS_UNAVAILABLE');
    return (Array.isArray(response.result.data?.clients) ? response.result.data.clients : [])
      .filter((client) => CLIENT_ID_RE.test(String(client.id || '')) && LABEL_RE.test(String(client.label || '')))
      .slice(0, 50);
  }

  async _resolveClient(label, protocol) {
    const normalized = String(label || '').trim();
    if (!LABEL_RE.test(normalized) || normalized.includes('..')) throw publicError('VPN_LABEL_INVALID');
    const matches = (await this._clients(protocol)).filter((client) => String(client.label).localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0);
    if (matches.length !== 1) throw publicError(matches.length ? 'VPN_CLIENT_LABEL_AMBIGUOUS' : 'VPN_CLIENT_NOT_FOUND');
    return matches[0];
  }

  async _create(command, context) {
    const protocol = normalizeProtocol(command.protocol);
    let rawArgs = { ...command.arguments, protocol };
    if (['revoke', 'rotate', 'export'].includes(command.action) && !rawArgs.clientId) {
      const client = await this._resolveClient(rawArgs.label, protocol);
      rawArgs = { clientId: client.id, protocol };
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
      const pending = await this.repository.latestPending({ userId: context.userId, originChannel: context.originChannel, originDeviceId: context.originDeviceId || null });
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
    const protocol = normalizeProtocol(record.arguments?.protocol);
    const operation = hostOperation(record.action, protocol);
    const hostArguments = { ...(record.arguments || {}) };
    delete hostArguments.protocol;
    let response;
    try {
      response = await this._request(operation, hostArguments, record.id);
    } catch (_) {
      await this.repository.complete({ requestId: record.id, status: 'unknown', errorCode: 'HOST_AGENT_UNREACHABLE' });
      return { answer: 'Результат VPN-действия пока неизвестен; повторно оно не запущено.', buttons: protocolButtons(protocol) };
    }
    const success = response.result.state === 'succeeded';
    const metadata = safeHostData(response.result.data || {});
    await this.repository.complete({ requestId: record.id, status: success ? 'succeeded' : response.result.state === 'unknown' ? 'unknown' : 'failed', result: metadata, errorCode: response.result.errorCode || null });
    await this.repository.audit({ userId: context.userId, requestId: record.id, type: success ? 'vpn.action.succeeded' : 'vpn.action.failed', metadata: { action: record.action, protocol, errorCode: response.result.errorCode || null } });
    if (!success) return { answer: `VPN-действие не выполнено: ${response.result.errorCode || 'неизвестный результат'}.`, buttons: protocolButtons(protocol) };
    const artifact = artifactFrom(response.result.data);
    const title = PROTOCOLS[protocol].title;
    const labels = {
      issue: `${title}-доступ создан. Файл для импорта в Happ приложен.`,
      revoke: `${title}-доступ отозван.`,
      rotate: `${title}-доступ перевыпущен. Старый ключ больше не работает; новый файл приложен.`,
      export: `Файл ${title} для импорта в Happ подготовлен.`,
      restart: `${title} VPN перезапущен.`,
    };
    return { answer: labels[record.action], ...(artifact ? { artifact } : {}), buttons: protocolButtons(protocol) };
  }

  async handleCallback(context) {
    const callback = parseVpnCallback(context.data);
    if (!callback) return null;
    await this._requireOwner(context.userId);
    if (callback.action === 'menu') return callback.protocol ? { answer: `Управление ${PROTOCOLS[callback.protocol].title}:`, buttons: protocolButtons(callback.protocol) } : { answer: 'Выбери VPN-протокол:', buttons: menuButtons() };
    if (callback.action === 'protocol') return { answer: `Управление ${PROTOCOLS[callback.protocol].title}:`, buttons: protocolButtons(callback.protocol) };
    if (callback.action === 'status') return this._read({ action: 'status', protocol: callback.protocol });
    if (callback.action === 'clients') return this._read({ action: 'clients', protocol: callback.protocol });
    if (callback.action === 'new') {
      const command = callback.protocol === 'hysteria2' ? '/vpn_hysteria2_issue Имя' : '/vpn_issue Имя';
      return { answer: `Напиши только имя нового доступа после команды: ${command}`, buttons: backButton(callback.protocol) };
    }
    if (callback.action === 'restart') return this._create({ action: 'restart', protocol: callback.protocol, arguments: {} }, context);
    if (callback.action === 'client') {
      const client = (await this._clients(callback.protocol)).find((item) => item.id === callback.clientId);
      if (!client) throw publicError('VPN_CLIENT_NOT_FOUND');
      const code = PROTOCOLS[callback.protocol].code;
      return {
        answer: `${PROTOCOLS[callback.protocol].title}-доступ «${client.label}». Выбери действие:`,
        buttons: [
          [{ text: '📄 Получить конфиг', data: `vpn:${code}:export:${client.id}` }],
          [{ text: '🔁 Перевыпустить', data: `vpn:${code}:rotate:${client.id}` }, { text: '🗑 Отозвать', data: `vpn:${code}:revoke:${client.id}` }],
          [{ text: '← К доступам', data: `vpn:${code}:clients` }],
        ],
      };
    }
    if (['export', 'rotate', 'revoke'].includes(callback.action)) {
      const client = (await this._clients(callback.protocol)).find((item) => item.id === callback.clientId);
      if (!client) throw publicError('VPN_CLIENT_NOT_FOUND');
      return this._create({ action: callback.action, protocol: callback.protocol, arguments: { clientId: client.id, label: client.label } }, context);
    }
    return this._decide({ decision: callback.action, requestId: callback.requestId }, context);
  }

  async handle(context) {
    const command = parseVpnCommand(context.text);
    if (!command) return null;
    await this._requireOwner(context.userId);
    if (command.kind === 'menu') return { answer: 'Выбери VPN-протокол:', buttons: menuButtons() };
    if (command.kind === 'invalid') return { answer: 'Открой /vpn и используй кнопки.', buttons: menuButtons() };
    if (command.kind === 'read') return this._read(command);
    if (command.kind === 'change') return this._create(command, context);
    return this._decide(command, context);
  }
}

module.exports = { CONFIRMATION_TTL_MS, PROTOCOLS, VpnCommandService, artifactFrom, menuButtons, parseVpnCallback, parseVpnCommand, protocolButtons, safeHostData, validateAction };
