const crypto = require('node:crypto');
const { buildRoutingArtifact, buildRoutingSummary } = require('./vpnRoutingService');

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
  if (/^\/vpn_(health|snapshot)$/i.test(value)) return { kind: 'read', action: 'health', protocol: 'both', arguments: {} };
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
  if ((match = /^\/vpn_(?:(hysteria2|hysteria|hy2|vless)_)?(?:routing|ru)$/i.exec(value)) || /^\/vpn_ru$/i.test(value)) {
    return { kind: 'routing', protocol: match && match[1]?.toLowerCase().startsWith('v') ? 'vless' : 'hysteria2' };
  }
  if ((match = /^\/vpn_(?:(hysteria2|hysteria|hy2|vless)_)?pc$/i.exec(value)) || /^\/vpn_pc$/i.test(value)) {
    return { kind: 'pc', protocol: match && match[1]?.toLowerCase().startsWith('v') ? 'vless' : 'hysteria2' };
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
  match = /^vpn:(v|h):(menu|status|clients|new|restart|routing|pc)$/.exec(data);
  if (match) return { action: match[2], protocol: match[1] === 'h' ? 'hysteria2' : 'vless' };
  match = /^vpn:(v|h):(client|export|rotate|revoke):(vpn-[a-f0-9]{12})$/.exec(data);
  if (match) return { action: match[2], protocol: match[1] === 'h' ? 'hysteria2' : 'vless', clientId: match[3] };
  if (['vpn:menu', 'vpn:status', 'vpn:clients', 'vpn:new', 'vpn:restart', 'vpn:routing', 'vpn:pc'].includes(data)) {
    return { action: data.slice(4), ...(data === 'vpn:menu' || data === 'vpn:routing' || data === 'vpn:pc' ? {} : { protocol: 'vless' }) };
  }
  if (data === 'vpn:health') return { action: 'health', protocol: 'both' };
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
    [{ text: '🏥 Диагностика (Health Snapshot)', data: 'vpn:health' }],
  ];
}

function renderProtocolGreeting(protocol) {
  const normalized = normalizeProtocol(protocol);
  if (normalized === 'hysteria2') {
    return [
      '⚡ **Hysteria 2 — основной скоростной VPN**',
      '',
      'Работает через современный протокол QUIC/UDP: максимальная скорость, устойчивость к блокировкам и минимальный пинг в играх.',
      '',
      '🚀 **Как настроить за 2 шага (парой кликов):**',
      '1️⃣ **Подключить VPN:**',
      '   Откройте **«👥 Мои доступы»** (или **«➕ Новый доступ»**) → скопируйте ключ `hy2://...` → откройте приложение **Happ** (оно сразу предложит добавить ключ).',
      '2️⃣ **Включить обход РФ:**',
      '   Нажмите **«🌐 Обход РФ (Госуслуги, банки)»** ниже → нажмите кнопку быстрой активации. Госуслуги, банки и маркетплейсы пойдут напрямую через ваш телефон, а заблокированные сайты и игры — через VPN!',
      '',
      '💻 *Для настройки на компьютере (Windows/Mac) нажмите «💻 Настройка на ПК» ниже.*',
      '💡 *Никаких отключений VPN ради банков больше не требуется.*',
    ].join('\n');
  }
  return '🛡 **VLESS — резервный протокол**\n\nИспользуется как запасной канал (TCP / Reality), если UDP-трафик полностью блокируется сетью.\n\nВыберите действие:';
}

function buildPcSetupGuide(protocol) {
  const normalized = normalizeProtocol(protocol);
  if (normalized === 'hysteria2') {
    return [
      '💻 **Настройка Hysteria 2 на ПК (Windows / macOS)**',
      '',
      'Hysteria 2 работает через быстрый протокол UDP/QUIC с маскировкой Salamander.',
      '',
      '📥 **1. Выберите приложение для ПК:**',
      '• **Hiddify** (⭐ Рекомендуется): самый удобный и стабильный клиент под Windows с автоматическим TUN-режимом.',
      '  Скачать: https://github.com/hiddify/hiddify-next/releases',
      '• **Happ Desktop** (официальный клиент экосистемы Happ):',
      '  Скачать: https://happ.su или https://github.com/happ-proxy/happ-desktop/releases',
      '• **Nekoray** (для продвинутых пользователей, ядро sing-box).',
      '',
      '⚠️ **ВНИМАНИЕ ПО v2rayN:**',
      'Стандартный v2rayN с ядром Xray-core **НЕ поддерживает** протокол Hysteria 2. Если вы используете v2rayN, переключитесь в меню бота на **«🛡 VLESS — резерв»** — он идеально работает в v2rayN!',
      '',
      '🚀 **2. Пошаговая настройка:**',
      '1. Установите **Hiddify** или **Happ Desktop**.',
      '2. В Telegram в разделе **«👥 Мои доступы»** скопируйте ключ `hy2://...` (нажмите на него в сообщении).',
      '3. В приложении на ПК нажмите `Ctrl+V` (или «+» → «Импорт из буфера обмена»).',
      '4. Включите **Режим TUN** (TUN Mode) и нажмите большую кнопку **«Подключить»**.',
      '',
      '❓ **ПОЧЕМУ ПИШЕТ «ПИНГ N/A» И КАК ИСПРАВИТЬ:**',
      '1️⃣ **Запуск от Администратора:** Для создания виртуального адаптера Wintun приложению на Windows требуются права администратора. Запускайте клиент через *«Правой кнопкой мыши → Запуск от имени администратора»*.',
      '2️⃣ **Брандмауэр Windows:** При первом запуске Защитник Windows запрашивает разрешение сети для ядра (`sing-box.exe`). Если вы нажали «Отмена» — сеть заблокирована. Разрешите доступ в настройках Брандмауэра.',
      '3️⃣ **Синхронизация времени:** Протоколы QUIC/TLS требуют точного времени! Если часы на ПК отстают или спешат даже на 30–60 секунд, сервер мгновенно отклоняет соединение. Откройте *Параметры Windows → Время и язык → «Синхронизировать сейчас»*.',
      '4️⃣ **Тип пинга в клиенте:** Обычный ICMP-пинг через прокси не проходит (всегда пишет n/a). Нажимайте *«Тест реальной задержки / URL Test»* (иконка молнии или Ctrl+R).',
      '5️⃣ **Блокировка UDP провайдером:** Если домашний интернет (Ростелеком, Дом.ру и др.) глушит UDP 443, переключитесь на **«🛡 VLESS — резерв»** (он работает по TCP и не блокируется).',
    ].join('\n');
  }

  return [
    '💻 **Настройка VLESS на ПК (Windows / macOS)**',
    '',
    'VLESS + REALITY работает по надежному протоколу TCP с маскировкой под веб-трафик браузера Chrome.',
    '',
    '📥 **1. Выберите приложение для ПК:**',
    '• **v2rayN** (⭐ Классика для Windows): быстрый и легкий.',
    '  Скачать: https://github.com/2dust/v2rayN/releases (архив `v2rayN-with-core.zip`)',
    '• **Hiddify** (универсальный клиент, поддерживает и VLESS, и Hysteria 2).',
    '• **Happ Desktop**.',
    '',
    '🚀 **2. Пошаговая настройка в v2rayN:**',
    '1. Скачайте архив `v2rayN-with-core.zip`, распакуйте в любую удобную папку.',
    '2. В Telegram в разделе **«👥 Мои доступы»** скопируйте ключ `vless://...`.',
    '3. В окне v2rayN нажмите `Ctrl+V` — сервер появится в списке.',
    '4. Внизу окна v2rayN в поле «Системный прокси» выберите **«Автоматически настраивать системный прокси»** (или включите **«Режим TUN»**).',
    '5. Выделите сервер и нажмите `Enter` (или правый клик → «Выбрать как активный сервер»).',
    '',
    '❓ **ПОЧЕМУ ПИШЕТ «ПИНГ N/A» И КАК ИСПРАВИТЬ:**',
    '1️⃣ **Нажимайте «Тест реальной задержки» (`Ctrl+R`)**, а не обычный пинг. Обычный пинг для VLESS всегда выдаёт n/a.',
    '2️⃣ **Синхронизируйте время Windows:** В *Параметры Windows → Время и язык → «Синхронизировать сейчас»*. Без точного времени Reality сбрасывает соединение.',
    '3️⃣ **Запуск от Администратора:** При включении «Режима TUN» запускайте v2rayN от имени Администратора.',
    '4️⃣ **Брандмауэр Windows:** Убедитесь, что `xray.exe` в папке v2rayN разрешён в Брандмауэре Windows.',
  ].join('\n');
}

function protocolButtons(protocol) {
  const code = PROTOCOLS[normalizeProtocol(protocol)].code;
  return [
    [{ text: '🔄 Статус', data: `vpn:${code}:status` }, { text: '👥 Мои доступы', data: `vpn:${code}:clients` }],
    [{ text: '➕ Новый доступ', data: `vpn:${code}:new` }],
    [{ text: '🌐 Обход РФ (Госуслуги, банки)', data: `vpn:${code}:routing` }, { text: '💻 Настройка на ПК', data: `vpn:${code}:pc` }],
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

function formatConnectionAnswer(protocol, action, data) {
  const normalized = normalizeProtocol(protocol);
  const title = PROTOCOLS[normalized]?.title || 'VPN';
  const uri = String(data?.shareUri || '').trim();
  const label = String(data?.client?.label || '').trim();

  if (action === 'revoke') {
    return `${title}-доступ ${label ? `«${label}» ` : ''}отозван.`;
  }
  if (action === 'restart') {
    return `${title} VPN перезапущен.`;
  }

  const actionHeaders = {
    issue: `✅ **${title}-доступ ${label ? `«${label}» ` : ''}создан!**`,
    rotate: `🔄 **${title}-доступ ${label ? `«${label}» ` : ''}перевыпущен!**\n*Старый ключ больше не действует.*`,
    export: `📄 **Ключ подключения ${title}${label ? ` «${label}»` : ''}:**`,
  };

  const header = actionHeaders[action] || `✅ **${title}-доступ готов!**`;

  if (!uri) {
    return `${header}\n\nФайл для импорта в Happ приложен.`;
  }

  return [
    header,
    '',
    '🔑 **Ваш ключ (нажмите для копирования в 1 клик):**',
    `\`${uri}\``,
    '',
    '📲 **Импорт в Happ за 1 клик:**',
    '• **iPhone / Android:** Нажмите на ключ выше (он скопируется в буфер) → откройте приложение Happ → оно автоматически предложит добавить сервер, нажмите **«Добавить»**!',
    '• **ПК (Windows / Mac):** Скопируйте ключ выше → в приложении Happ или Hiddify нажмите **«+»** → **«Импорт из буфера обмена»** (или `Ctrl+V`). *(Для v2rayN используйте VLESS)*.',
    '',
    '💻 *Подробная пошаговая инструкция для ПК и решение проблем (пинг n/a) — кнопка «💻 Настройка на ПК» ниже.*',
    '💡 *Импорт через буфер обмена работает без ошибок на всех платформах.*',
    '⚠️ *Не используйте «Открыть через Happ» для прикреплённого .txt файла — Happ пытается прочесть .txt как JSON и выдаёт ошибку «конфиг неправильный». Просто скопируйте ключ выше!*',
    '',
    '🌐 **Обход РФ (Госуслуги, банки, маркетплейсы):**',
    'Нажмите кнопку **«🌐 Обход РФ»** ниже, чтобы все российские сайты работали напрямую без VPN на максимальной скорости.',
  ].join('\n');
}

function actionPrompt(action, args) {
  const title = PROTOCOLS[normalizeProtocol(args.protocol)].title;
  if (action === 'issue') return `Создать новый ${title}-доступ «${args.label}»?`;
  if (action === 'restart') return `Перезапустить ${title} VPN? Активные соединения кратковременно прервутся.`;
  const verbs = { revoke: 'Отозвать', rotate: 'Перевыпустить', export: 'Экспортировать' };
  return `${verbs[action]} ${title}-доступ «${args.label || 'выбранный'}»?`;
}

function humanErrorMessage(code, context = {}) {
  const label = context.label ? ` «${context.label}»` : '';
  const protocolTitle = PROTOCOLS[normalizeProtocol(context.protocol)]?.title || 'VPN';
  switch (code) {
    case 'VPN_CLIENT_LABEL_EXISTS':
      return `⚠️ Доступ с именем${label} уже существует!\n\nВы можете скопировать его ключ в разделе «👥 Мои доступы» или создать доступ с другим именем (например, «${context.label || 'Доступ'} 2»).`;
    case 'VPN_CLIENT_LIMIT':
      return `Достигнут лимит подключений (максимум 50). Удалите ненужные доступы в разделе «👥 Мои доступы».`;
    case 'VPN_CLIENT_NOT_FOUND':
      return `Выбранный ${protocolTitle}-доступ не найден.`;
    case 'VPN_LABEL_INVALID':
      return 'Недопустимое имя доступа. Используйте от 1 до 40 символов (буквы, цифры, дефис, пробел).';
    case 'VPN_HYSTERIA_RESTART_FAILED':
    case 'VPN_RESTART_FAILED':
      return `Не удалось перезапустить ${protocolTitle}. Попробуйте ещё раз через минуту.`;
    case 'HOST_AGENT_UNREACHABLE':
      return 'Серверный агент временно недоступен. Попробуйте позже.';
    default:
      return `VPN-действие не выполнено: ${code || 'неизвестная ошибка'}.`;
  }
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
    if (command.action === 'health') {
      const response = await this._request('vpn.health.snapshot', {});
      if (response.result.state !== 'succeeded') return { answer: 'Диагностика VPN временно недоступна.', buttons: menuButtons() };
      const data = response.result.data || {};
      const format = (state) => (state === 'healthy' ? '✅ OK' : state === 'degraded' ? '⚠️ Degraded' : '❌ Ошибка');
      const xray = data.xray || {};
      const hy2 = data.hysteria2 || {};
      const answer = [
        '🏥 **Диагностика VPN (Health Snapshot):**',
        `🖥 Хост VPS: ${format(data.host)}`,
        '',
        '🛡 **VLESS (Xray):**',
        `• Служба: ${format(xray.service)}`,
        `• Конфигурация: ${format(xray.config)}`,
        `• Порт: ${format(xray.listener)}`,
        '',
        '⚡ **Hysteria 2:**',
        `• Служба: ${format(hy2.service)}`,
        `• Конфигурация: ${format(hy2.config)}`,
        `• Порт: ${format(hy2.listener)}`,
        `• Авторизация: ${format(hy2.auth)}`,
      ].join('\n');
      return { answer, buttons: menuButtons() };
    }
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
    if (!success) {
      const errorCode = response.result.errorCode;
      const isLabelExists = errorCode === 'VPN_CLIENT_LABEL_EXISTS';
      const code = PROTOCOLS[protocol].code;
      const buttons = isLabelExists
        ? [
            [{ text: '👥 Мои доступы', data: `vpn:${code}:clients` }],
            [{ text: '➕ Новый доступ', data: `vpn:${code}:new` }],
            [{ text: '← В меню VPN', data: `vpn:${code}:menu` }],
          ]
        : protocolButtons(protocol);
      return { answer: humanErrorMessage(errorCode, { protocol, label: record.arguments?.label }), buttons };
    }
    const artifact = artifactFrom(response.result.data);
    const answer = formatConnectionAnswer(protocol, record.action, response.result.data);
    return { answer, ...(artifact ? { artifact } : {}), buttons: protocolButtons(protocol) };
  }

  async handleCallback(context) {
    const callback = parseVpnCallback(context.data);
    if (!callback) return null;
    await this._requireOwner(context.userId);
    if (callback.action === 'pc') {
      const protocol = callback.protocol || 'hysteria2';
      return {
        answer: buildPcSetupGuide(protocol),
        buttons: protocolButtons(protocol),
      };
    }
    if (callback.action === 'routing') {
      return {
        answer: buildRoutingSummary(),
        artifact: buildRoutingArtifact(),
        buttons: [
          [{ text: '🚀 Активировать в Happ (1 клик)', url: 'https://jarvis.rilora.ru/happ-routing' }],
          ...protocolButtons(callback.protocol || 'hysteria2'),
        ],
      };
    }
    if (callback.action === 'menu') return callback.protocol ? { answer: renderProtocolGreeting(callback.protocol), buttons: protocolButtons(callback.protocol) } : { answer: 'Выбери VPN-протокол:', buttons: menuButtons() };
    if (callback.action === 'protocol') return { answer: renderProtocolGreeting(callback.protocol), buttons: protocolButtons(callback.protocol) };
    if (callback.action === 'health') return this._read({ action: 'health', protocol: 'both' });
    if (callback.action === 'status') return this._read({ action: 'status', protocol: callback.protocol });
    if (callback.action === 'clients') return this._read({ action: 'clients', protocol: callback.protocol });
    if (callback.action === 'new') {
      return {
        answer: `Как назвать новый ${PROTOCOLS[callback.protocol].title}-доступ? Например: iPhone Максима`,
        requestInput: { kind: 'vpn_access_label', context: { protocol: callback.protocol } },
      };
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
    if (command.kind === 'pc') {
      const protocol = command.protocol || 'hysteria2';
      return {
        answer: buildPcSetupGuide(protocol),
        buttons: protocolButtons(protocol),
      };
    }
    if (command.kind === 'menu') return { answer: 'Выбери VPN-протокол:', buttons: menuButtons() };
    if (command.kind === 'routing') {
      return {
        answer: buildRoutingSummary(),
        artifact: buildRoutingArtifact(),
        buttons: [
          [{ text: '🚀 Активировать в Happ (1 клик)', url: 'https://jarvis.rilora.ru/happ-routing' }],
          ...protocolButtons(command.protocol || 'hysteria2'),
        ],
      };
    }
    if (command.kind === 'invalid') return { answer: 'Открой /vpn и используй кнопки.', buttons: menuButtons() };
    if (command.kind === 'read') return this._read(command);
    if (command.kind === 'change') return this._create(command, context);
    return this._decide(command, context);
  }

  async openMenu(context) {
    await this._requireOwner(context.userId);
    return { answer: 'Выбери VPN-протокол:', buttons: menuButtons() };
  }

  async requestAction({ action, protocol, arguments: actionArguments = {}, ...context }) {
    await this._requireOwner(context.userId);
    return this._create({ action, protocol, arguments: actionArguments }, context);
  }
}

module.exports = { CONFIRMATION_TTL_MS, PROTOCOLS, VpnCommandService, artifactFrom, buildPcSetupGuide, formatConnectionAnswer, menuButtons, parseVpnCallback, parseVpnCommand, protocolButtons, safeHostData, validateAction };
