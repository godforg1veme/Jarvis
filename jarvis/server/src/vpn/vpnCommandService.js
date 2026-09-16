const crypto = require('node:crypto');
const { buildRoutingArtifact, buildRoutingSummary } = require('./vpnRoutingService');
const { parseVpnHealth } = require('./vpnHealthSchema');
const { ExternalProbeMonitor } = require('../operations/vpnSupervisor/externalProbeMonitor');
const { ProbeCredentialWorkflow, ProbeWorkflowError, probeBindingFor } = require('./vpnProbeCredentialWorkflow');

const CONFIRMATION_TTL_MS = 60 * 1000;
const REQUEST_ID_RE = /^[a-f0-9-]{36}$/i;
const CLIENT_ID_RE = /^vpn-[a-f0-9]{12}$/;
const LABEL_RE = /^[A-Za-zА-Яа-яЁё0-9_. -]{1,40}$/;
const PROTOCOLS = Object.freeze({ vless: { code: 'v', title: 'VLESS' }, hysteria2: { code: 'h', title: 'Hysteria2' } });
const NODES = Object.freeze({
  de: Object.freeze({ code: 'de', country: 'Германия', flag: '🇩🇪', city: 'Frankfurt' }),
  nl: Object.freeze({ code: 'nl', country: 'Нидерланды', flag: '🇳🇱', city: 'Amsterdam' }),
});
const VPN_SEVERITY_LABELS = Object.freeze({ info: 'информация', warning: 'предупреждение', error: 'ошибка', critical: 'критическая' });
const VPN_SCOPE_LABELS = Object.freeze({ host: 'VPS', xray: 'Xray', hysteria2: 'Hysteria2', multi: 'оба VPN-стека' });
const VPN_CAUSE_LABELS = Object.freeze({
  snapshot_contract: 'некорректный снимок состояния', host_probe: 'состояние VPS', host_dns: 'DNS хоста', host_outbound: 'исходящая сеть хоста',
  xray_config: 'конфигурация Xray', xray_service: 'служба Xray', xray_listener: 'TCP listener Xray',
  hysteria2_config: 'конфигурация Hysteria2', hysteria2_service: 'служба Hysteria2', hysteria2_listener: 'UDP listener Hysteria2',
  host_agent_auth_dependency: 'локальная auth-зависимость Host Agent', hysteria_auth_credential: 'проверка Hysteria2 credential',
  multi_stack_local_failure: 'одновременный локальный сбой двух VPN-стеков', insufficient_evidence: 'недостаточно подтверждённых данных',
});
const VPN_CHECK_LABELS = Object.freeze({
  host_resources: 'проверить ресурсы VPS', host_dns_probe: 'повторить DNS probe', host_outbound_probe: 'повторить HTTPS probe',
  xray_config_test: 'проверить конфигурацию Xray', xray_service_status: 'проверить службу Xray', xray_listener_probe: 'проверить TCP listener Xray',
  hysteria2_config_test: 'проверить конфигурацию Hysteria2', hysteria2_service_status: 'проверить службу Hysteria2', hysteria2_listener_probe: 'проверить UDP listener Hysteria2',
  host_agent_status: 'проверить Host Agent', hysteria_auth_endpoint_probe: 'повторить auth endpoint probe',
  hysteria_auth_credential_probe: 'повторить credential probe', vpn_snapshot_repeat: 'повторить снимок состояния',
});

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

function normalizeNode(value) {
  const node = String(value || 'de').toLowerCase();
  return NODES[node] ? node : 'de';
}

function parseVpnCommand(text) {
  const value = String(text || '').trim();
  let match;
  if (/^\/vpn(?:_sub|_subscription|_subscriptions)?$/i.test(value)) {
    if (/^\/vpn_(?:sub|subscription|subscriptions)$/i.test(value)) return { kind: 'subscription', action: 'menu' };
    return { kind: 'menu' };
  }
  if (/^\/vpn_(health|snapshot)$/i.test(value)) return { kind: 'read', action: 'health', protocol: 'both', arguments: {} };
  if ((match = /^\/vpn_(?:(de|nl)_)?status$/i.exec(value))) {
    return { kind: 'read', action: 'status', protocol: 'vless', node: match[1] || 'de', arguments: {} };
  }
  if ((match = /^\/vpn_(?:(de|nl)_)?clients$/i.exec(value))) {
    return { kind: 'read', action: 'clients', protocol: 'vless', node: match[1] || 'de', arguments: {} };
  }
  if ((match = /^\/vpn_(?:(de|nl)_)?(hysteria2|hysteria|hy2)_(status|clients)$/i.exec(value))) {
    return { kind: 'read', action: match[3].toLowerCase(), protocol: 'hysteria2', node: match[1] || 'de', arguments: {} };
  }
  if ((match = /^\/vpn_(?:(de|nl)_)?(?:(hysteria2|hysteria|hy2)_)?issue\s+(.{1,80})$/iu.exec(value))) {
    return { kind: 'change', action: 'issue', protocol: match[2] ? 'hysteria2' : 'vless', node: match[1] || 'de', arguments: { label: match[3].trim() } };
  }
  if ((match = /^\/vpn_(?:(de|nl)_)?(?:(hysteria2|hysteria|hy2)_)?(revoke|rotate|export)\s+(.{1,80})$/iu.exec(value))) {
    return { kind: 'change', action: match[3].toLowerCase(), protocol: match[2] ? 'hysteria2' : 'vless', node: match[1] || 'de', arguments: { label: match[4].trim() } };
  }
  if ((match = /^\/vpn_(?:(de|nl)_)?(?:(hysteria2|hysteria|hy2)_)?restart$/i.exec(value))) {
    return { kind: 'change', action: 'restart', protocol: match[2] ? 'hysteria2' : 'vless', node: match[1] || 'de', arguments: {} };
  }
  if ((match = /^\/vpn_(?:(de|nl)_)?(?:(hysteria2|hysteria|hy2|vless)_)?(?:routing|ru)$/i.exec(value)) || /^\/vpn_ru$/i.test(value)) {
    return { kind: 'routing', protocol: match && match[2]?.toLowerCase().startsWith('v') ? 'vless' : 'hysteria2', node: match?.[1] || 'de' };
  }
  if ((match = /^\/vpn_(?:(de|nl)_)?(?:(hysteria2|hysteria|hy2|vless)_)?pc$/i.exec(value)) || /^\/vpn_pc$/i.test(value)) {
    return { kind: 'pc', protocol: match && match[2]?.toLowerCase().startsWith('v') ? 'vless' : 'hysteria2', node: match?.[1] || 'de' };
  }
  if ((match = /^\/vpn_(confirm|reject)(?:\s+([a-f0-9-]{36}))?$/i.exec(value))) {
    return { kind: 'decision', decision: match[1].toLowerCase(), requestId: match[2]?.toLowerCase() || null };
  }
  if (/^\/vpn_/i.test(value)) return { kind: 'invalid' };
  return null;
}

function parseVpnCallback(value) {
  const data = String(value || '');
  if (data === 'vpn:menu') return { action: 'menu' };
  if (data === 'vpn:health') return { action: 'health', protocol: 'both' };
  if (data === 'vpn:sub:menu') return { action: 'sub-menu' };
  if (data === 'vpn:sub:new') return { action: 'sub-new' };
  let match = /^vpn:sub:view:([a-f0-9-]{36})$/.exec(data);
  if (match) return { action: 'sub-view', subscriptionId: match[1] };
  match = /^vpn:sub:rotate:([a-f0-9-]{36})$/.exec(data);
  if (match) return { action: 'sub-rotate', subscriptionId: match[1] };
  match = /^vpn:sub:revoke:([a-f0-9-]{36})$/.exec(data);
  if (match) return { action: 'sub-revoke', subscriptionId: match[1] };
  match = /^vpn:sub:repair:([a-f0-9-]{36})$/.exec(data);
  if (match) return { action: 'sub-repair', subscriptionId: match[1] };
  if (data === 'vpn:probe:menu') return { action: 'probe-menu' };
  if (data === 'vpn:probe:enable') return { action: 'probe-enable' };
  if (data === 'vpn:probe:disable') return { action: 'probe-disable' };

  match = /^vpn:probe:(install|rotate):(de|nl):(v|h)$/.exec(data);
  if (match) return {
    action: match[1] === 'install' ? 'probe-install' : 'probe-rotate',
    sourceNode: match[2], protocol: match[3] === 'h' ? 'hysteria2' : 'vless',
  };

  match = /^vpn:c:(de|nl)$/.exec(data);
  if (match) return { action: 'country', node: match[1] };

  match = /^vpn:(de|nl):(v|h):menu$/.exec(data);
  if (match) return { action: 'menu', node: match[1], protocol: match[2] === 'h' ? 'hysteria2' : 'vless' };

  match = /^vpn:(de|nl):(v|h):(status|clients|new|restart|routing|pc)$/.exec(data);
  if (match) return { action: match[3], node: match[1], protocol: match[2] === 'h' ? 'hysteria2' : 'vless' };

  match = /^vpn:(de|nl):(v|h):(client|export|rotate|revoke):(vpn-[a-f0-9]{12})$/.exec(data);
  if (match) return { action: match[3], node: match[1], protocol: match[2] === 'h' ? 'hysteria2' : 'vless', clientId: match[4] };

  match = /^vpn:p:(v|h)$/.exec(data);
  if (match) return { action: 'protocol', protocol: match[1] === 'h' ? 'hysteria2' : 'vless', node: 'de' };

  match = /^vpn:(v|h):(menu|status|clients|new|restart|routing|pc)$/.exec(data);
  if (match) return { action: match[2], protocol: match[1] === 'h' ? 'hysteria2' : 'vless', node: 'de' };

  match = /^vpn:(v|h):(client|export|rotate|revoke):(vpn-[a-f0-9]{12})$/.exec(data);
  if (match) return { action: match[2], protocol: match[1] === 'h' ? 'hysteria2' : 'vless', clientId: match[3], node: 'de' };

  if (['vpn:status', 'vpn:clients', 'vpn:new', 'vpn:restart', 'vpn:routing', 'vpn:pc'].includes(data)) {
    return { action: data.slice(4), protocol: 'vless', node: 'de' };
  }
  match = /^vpn:(client|export|rotate|revoke):(vpn-[a-f0-9]{12})$/.exec(data);
  if (match) return { action: match[1], protocol: 'vless', clientId: match[2], node: 'de' };
  match = /^vpn:(confirm|reject):([a-f0-9-]{36})$/i.exec(data);
  if (match) return { action: match[1], requestId: match[2].toLowerCase() };
  return null;
}

function isVpnCallback(value) {
  return Boolean(parseVpnCallback(value));
}

function menuButtons() {
  return [
    [{ text: '🇩🇪 Германия (Frankfurt)', data: 'vpn:c:de' }, { text: '🇳🇱 Нидерланды (Amsterdam)', data: 'vpn:c:nl' }],
    [{ text: '📲 Подписки (Happ)', data: 'vpn:sub:menu' }],
    [{ text: '🏥 Диагностика (Health Snapshot)', data: 'vpn:health' }],
    [{ text: '🧪 Внешние проверки VPN', data: 'vpn:probe:menu' }],
  ];
}

function countryProtocolButtons(node = 'de') {
  const n = NODES[normalizeNode(node)];
  return [
    [{ text: `⚡ Hysteria 2 — рекомендуется`, data: `vpn:${n.code}:h:menu` }],
    [{ text: `🛡 VLESS — резерв`, data: `vpn:${n.code}:v:menu` }],
    [{ text: '← Выбор страны', data: 'vpn:menu' }],
  ];
}

function renderProtocolGreeting(protocol, node = 'de') {
  const normalized = normalizeProtocol(protocol);
  const n = NODES[normalizeNode(node)];
  if (normalized === 'hysteria2') {
    return [
      `⚡ **Hysteria 2 — основной скоростной VPN (${n.flag} ${n.country})**`,
      `📍 *Сервер: ${n.country}, ${n.city}*`,
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
  return `🛡 **VLESS — резервный протокол (${n.flag} ${n.country})**\n📍 *Сервер: ${n.country}, ${n.city}*\n\nИспользуется как запасной канал (TCP / Reality), если UDP-трафик полностью блокируется сетью.\n\nВыберите действие:`;
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

function protocolButtons(protocol, node = 'de') {
  const normProto = normalizeProtocol(protocol);
  const code = PROTOCOLS[normProto].code;
  const n = NODES[normalizeNode(node)];
  return [
    [{ text: '🔄 Статус', data: `vpn:${n.code}:${code}:status` }, { text: '👥 Мои доступы', data: `vpn:${n.code}:${code}:clients` }],
    [{ text: '➕ Новый доступ', data: `vpn:${n.code}:${code}:new` }],
    [{ text: '🌐 Обход РФ (Госуслуги, банки)', data: `vpn:${n.code}:${code}:routing` }, { text: '💻 Настройка на ПК', data: `vpn:${n.code}:${code}:pc` }],
    [{ text: '♻️ Перезапустить', data: `vpn:${n.code}:${code}:restart` }],
    [{ text: `← Выбор протокола (${n.country})`, data: `vpn:c:${n.code}` }],
    [{ text: '← Выбор страны', data: 'vpn:menu' }],
  ];
}

function backButton(protocol, node = 'de') {
  const normProto = normalizeProtocol(protocol);
  const code = PROTOCOLS[normProto].code;
  const n = NODES[normalizeNode(node)];
  return [[{ text: '← Назад', data: `vpn:${n.code}:${code}:menu` }]];
}

function validateAction(action, args) {
  if (action === 'probe.install' || action === 'probe.rotate') {
    try {
      return probeBindingFor({
        sourceNode: String(args?.sourceNode || ''),
        runnerNode: String(args?.runnerNode || ''),
        protocol: String(args?.protocol || ''),
        clientId: String(args?.clientId || '').toLowerCase(),
        label: String(args?.label || ''),
      });
    } catch (_) {
      throw publicError('PROBE_BINDING_INVALID');
    }
  }
  if (action === 'probe.enable' || action === 'probe.disable') {
    if (args && Object.keys(args).length > 0) throw publicError('VPN_ACTION_INVALID');
    return {};
  }
  const protocol = normalizeProtocol(args?.protocol);
  const node = normalizeNode(args?.node);
  if (action === 'issue') {
    const label = String(args?.label || '').trim();
    if (!LABEL_RE.test(label) || label.includes('..')) throw publicError('VPN_LABEL_INVALID');
    return { protocol, node, label };
  }
  if (['revoke', 'rotate', 'export'].includes(action)) {
    const clientId = String(args?.clientId || '').toLowerCase();
    if (!CLIENT_ID_RE.test(clientId)) throw publicError('VPN_CLIENT_ID_INVALID');
    return { protocol, node, clientId };
  }
  if (action === 'restart') return { protocol, node };
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

function safeProbeWorkflowData(data = {}) {
  const targetNode = NODES[data.targetNode] ? data.targetNode : null;
  const runnerNode = NODES[data.runnerNode] ? data.runnerNode : null;
  const protocol = PROTOCOLS[data.protocol] ? data.protocol : null;
  if (typeof data.monitoring === 'boolean') return { monitoring: data.monitoring };
  return {
    ...(targetNode ? { targetNode } : {}),
    ...(runnerNode ? { runnerNode } : {}),
    ...(protocol ? { protocol } : {}),
    ...(typeof data.installedAt === 'string' && data.installedAt.length <= 40 ? { installedAt: data.installedAt } : {}),
  };
}

function artifactFrom(data, node) {
  const uri = String(data?.shareUri || '');
  const client = data?.client;
  const vless = uri.startsWith('vless://');
  const hysteria2 = uri.startsWith('hy2://') || uri.startsWith('hysteria2://');
  if ((!vless && !hysteria2) || uri.length > 4096 || !client || !CLIENT_ID_RE.test(String(client.id || ''))) return null;
  const safeLabel = String(client.label || 'happ').replace(/[^A-Za-zА-Яа-яЁё0-9_. -]/g, '').trim().slice(0, 30) || 'happ';
  const nodePrefix = node ? `-${node}` : '';
  return {
    kind: hysteria2 ? 'happ-hysteria2' : 'happ-vless',
    filename: `${safeLabel}${nodePrefix}-${hysteria2 ? 'hysteria2' : 'vless'}.txt`,
    content: `${uri}\n`,
  };
}

function formatConnectionAnswer(protocol, action, data, node) {
  const normalized = normalizeProtocol(protocol);
  const title = PROTOCOLS[normalized]?.title || 'VPN';
  const uri = String(data?.shareUri || '').trim();
  const label = String(data?.client?.label || '').trim();
  const n = node ? NODES[normalizeNode(node)] : null;
  const nodeSuffix = n ? ` (${n.flag} ${n.country})` : '';

  if (action === 'revoke') {
    return `${title}-доступ ${label ? `«${label}» ` : ''}отозван.${nodeSuffix}`;
  }
  if (action === 'restart') {
    return `${title} VPN перезапущен.${nodeSuffix}`;
  }

  const actionHeaders = {
    issue: `✅ **${title}-доступ ${label ? `«${label}» ` : ''}создан!**${nodeSuffix}`,
    rotate: `🔄 **${title}-доступ ${label ? `«${label}» ` : ''}перевыпущен!**${nodeSuffix}\n*Старый ключ больше не действует.*`,
    export: `📄 **Ключ подключения ${title}${label ? ` «${label}»` : ''}:${nodeSuffix}**`,
  };

  const header = actionHeaders[action] || `✅ **${title}-доступ готов!**${nodeSuffix}`;

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
  if (action === 'probe.install' || action === 'probe.rotate') {
    const source = NODES[args.sourceNode];
    const runner = NODES[args.runnerNode];
    const verb = action === 'probe.install' ? 'Установить' : 'Обновить';
    return `${verb} тестовый ключ ${PROTOCOLS[args.protocol].title} для проверки ${runner.flag} ${runner.country} → ${source.flag} ${source.country}? Ключ не будет показан или сохранён в Jarvis.`;
  }
  if (action === 'probe.enable') return 'Включить периодические внешние проверки между Германией и Нидерландами? Сначала должны успешно пройти все четыре разовые проверки.';
  if (action === 'probe.disable') return 'Отключить периодические внешние проверки между Германией и Нидерландами? VPN-службы и ключи пользователей не изменятся.';
  const title = PROTOCOLS[normalizeProtocol(args.protocol)].title;
  const n = args.node ? NODES[normalizeNode(args.node)] : null;
  const nodeSuffix = n ? ` (${n.flag} ${n.country})` : '';
  if (action === 'issue') return `Создать новый ${title}-доступ «${args.label}»${nodeSuffix}?`;
  if (action === 'restart') return `Перезапустить ${title} VPN${nodeSuffix}? Активные соединения кратковременно прервутся.`;
  const verbs = { revoke: 'Отозвать', rotate: 'Перевыпустить', export: 'Экспортировать' };
  return `${verbs[action]} ${title}-доступ «${args.label || 'выбранный'}»${nodeSuffix}?`;
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
    this.clients = options.clients || (options.client ? { de: options.client } : {});
    this.client = options.client || this.clients.de;
    this.ownerTelegramId = String(options.ownerTelegramId || '');
    this.now = options.now || (() => new Date());
    this.externalProbeMonitor = options.externalProbeMonitor || (this.clients.de && this.clients.nl
      ? new ExternalProbeMonitor({ clients: this.clients, now: this.now }) : null);
    this.probeWorkflow = options.probeWorkflow || new ProbeCredentialWorkflow({
      clients: this.clients,
      now: this.now,
      verifiedBindings: async () => (typeof this.repository.hasVerifiedProbeBindings === 'function'
        ? this.repository.hasVerifiedProbeBindings() : false),
    });
    this.subscriptionService = options.subscriptionService || null;
    this.publicUrl = (options.publicUrl || 'https://jarvis.rilora.ru').replace(/\/+$/, '');
  }

  _getClient(node = 'de') {
    const normalized = normalizeNode(node);
    const client = this.clients?.[normalized] || (normalized === 'de' ? this.client : null);
    if (!client) throw publicError('HOST_AGENT_UNREACHABLE');
    return client;
  }

  async _requireOwner(userId) {
    if (!await this.repository.isOwner({ userId, ownerTelegramId: this.ownerTelegramId })) throw publicError('VPN_OWNER_REQUIRED');
  }

  async _request(operation, args, requestId = crypto.randomUUID(), node = 'de') {
    const client = this._getClient(node);
    return client.request({ version: 1, requestId, operation, arguments: args, sentAt: this.now().toISOString() });
  }

  async _read(command) {
    const node = normalizeNode(command.node || 'de');
    const n = NODES[node];
    if (command.action === 'health') {
      const nodeKeys = Object.keys(this.clients || {});
      const targetNodes = nodeKeys.length > 0 ? nodeKeys : ['de'];

      if (targetNodes.length === 1) {
        let response;
        try {
          response = await this._request('vpn.health.snapshot', {}, undefined, targetNodes[0]);
        } catch (_) {
          return { answer: 'Диагностика VPN временно недоступна.', buttons: menuButtons() };
        }
        if (!response || response.result?.state !== 'succeeded') {
          return { answer: 'Диагностика VPN временно недоступна.', buttons: menuButtons() };
        }
        let data;
        try {
          data = parseVpnHealth(response.result.data);
        } catch (_) {
          return { answer: 'Диагностика VPN вернула некорректные данные.', buttons: menuButtons() };
        }

        const format = (state) => (
          state === 'healthy' ? '✅ OK' :
          state === 'degraded' ? '⚠️ Degraded' :
          state === 'unknown' ? '❓ Неизвестно (требуется внешний узел)' :
          '❌ Ошибка'
        );
        const xray = data.xray || {};
        const hy2 = data.hysteria2 || {};
        const net = data.network;
        const answer = [
          '🏥 **Диагностика VPN (Health Snapshot):**',
          `🖥 Хост VPS: ${format(data.host)}`,
          ...(net ? [
            `• DNS: ${format(net.dns)}`,
            `• Интернет (HTTPS): ${format(net.outbound)}`,
          ] : []),
          '',
          '🛡 **VLESS (Xray):**',
          `• Служба: ${format(xray.service)}`,
          `• Конфигурация: ${format(xray.config)}`,
          `• Порт: ${format(xray.listener)}`,
          ...(xray.protocolProbe ? [`• Протокол (Probe): ${format(xray.protocolProbe)}`] : []),
          '',
          '⚡ **Hysteria 2:**',
          `• Служба: ${format(hy2.service)}`,
          `• Конфигурация: ${format(hy2.config)}`,
          `• Порт: ${format(hy2.listener)}`,
          `• Авторизация: ${format(hy2.auth)}`,
          ...(hy2.authEndpoint ? [`  - Эндпоинт auth: ${format(hy2.authEndpoint)}`] : []),
          ...(hy2.authCredentialProbe ? [`  - Проверка ключа: ${format(hy2.authCredentialProbe)}`] : []),
          ...(hy2.protocolProbe ? [`• Протокол (Probe): ${format(hy2.protocolProbe)}`] : []),
          '',
          ...(data.diagnosis?.primary ? [
            `🚨 **Инцидент:** ${data.diagnosis.primary.code}`,
            `• Уровень: ${VPN_SEVERITY_LABELS[data.diagnosis.primary.severity]}`,
            `• Затронуто: ${VPN_SCOPE_LABELS[data.diagnosis.primary.scope]}`,
            `• Причина: ${VPN_CAUSE_LABELS[data.diagnosis.primary.likelyCause]}`,
            `• Уверенность: ${data.diagnosis.primary.confidence}`,
            `• Следующие проверки: ${data.diagnosis.primary.safeNextChecks.map((check) => VPN_CHECK_LABELS[check]).join(', ')}`,
          ] : ['✅ **Активных VPN-инцидентов нет.**']),
          '🤖 Автоматический ремонт: отключён на этом этапе.',
        ].join('\n');
        return { answer, buttons: menuButtons() };
      }

      const format = (state) => (
        state === 'healthy' ? '✅ OK' :
        state === 'degraded' ? '⚠️ Degraded' :
        state === 'unknown' ? '❓ Неизвестно' :
        '❌ Ошибка'
      );

      const renderNodeHealth = (nodeCode, result) => {
        const targetNode = NODES[nodeCode] || { flag: '🌐', country: nodeCode.toUpperCase(), city: '' };
        if (!result || result.state !== 'succeeded') {
          return [
            `${targetNode.flag} **${targetNode.country} (${targetNode.city || nodeCode.toUpperCase()}):**`,
            '❌ Серверный агент недоступен.',
          ].join('\n');
        }
        let data;
        try {
          data = parseVpnHealth(result.data);
        } catch (_) {
          return [
            `${targetNode.flag} **${targetNode.country} (${targetNode.city || nodeCode.toUpperCase()}):**`,
            '❌ Ошибка формата данных диагностики.',
          ].join('\n');
        }
        const xray = data.xray || {};
        const hy2 = data.hysteria2 || {};
        const net = data.network;
        return [
          `${targetNode.flag} **${targetNode.country} (${targetNode.city || nodeCode.toUpperCase()}):**`,
          `🖥 Хост VPS: ${format(data.host)}`,
          ...(net ? [
            `• DNS: ${format(net.dns)}`,
            `• Интернет (HTTPS): ${format(net.outbound)}`,
          ] : []),
          `🛡 VLESS: служба ${format(xray.service)}, порт ${format(xray.listener)}`,
          `⚡ Hysteria 2: служба ${format(hy2.service)}, порт ${format(hy2.listener)}, auth ${format(hy2.auth)}`,
          ...(data.diagnosis?.primary ? [
            `🚨 Инцидент: ${data.diagnosis.primary.code} (${VPN_SEVERITY_LABELS[data.diagnosis.primary.severity] || 'info'}) - ${VPN_CAUSE_LABELS[data.diagnosis.primary.likelyCause] || data.diagnosis.primary.likelyCause}`,
          ] : ['✅ Инцидентов нет.']),
        ].join('\n');
      };

      const results = await Promise.allSettled(
        targetNodes.map(async (code) => {
          const resp = await this._request('vpn.health.snapshot', {}, undefined, code);
          return { code, result: resp?.result };
        })
      );

      const external = this.externalProbeMonitor
        ? await Promise.all(targetNodes.map((code) => this.externalProbeMonitor.snapshot(code))) : null;
      const sections = results.map((res, idx) => {
        const code = targetNodes[idx];
        const probe = external?.[idx];
        const formatExternal = (item) => item.status === 'healthy' ? '✅ OK'
          : item.status === 'failed' ? '❌ Не прошёл (требует проверки)' : '❓ Нет достоверного результата';
        const probeLines = probe ? [
          `🌐 Внешняя проба с другого VPS: VLESS 443 ${formatExternal(probe.checks.vless_tcp_443)}, VLESS 8443 ${formatExternal(probe.checks.vless_tcp_8443)}, Hysteria2 443/UDP ${formatExternal(probe.checks.hysteria2_udp_443)}.`,
        ] : [];
        if (res.status === 'fulfilled') {
          return [renderNodeHealth(code, res.value.result), ...probeLines].join('\n');
        }
        const targetNode = NODES[code] || { flag: '🌐', country: code.toUpperCase(), city: '' };
        return [`${targetNode.flag} **${targetNode.country}:** ❌ Серверный агент недоступен.`, ...probeLines].join('\n');
      });

      const answer = [
        '🏥 **Диагностика всех VPN-нод (Health Snapshot):**',
        '',
        sections.join('\n\n'),
        '',
        '🤖 Автоматический ремонт: отключён на этом этапе.',
      ].join('\n');

      return { answer, buttons: menuButtons() };
    }

    const protocol = normalizeProtocol(command.protocol);
    const title = PROTOCOLS[protocol].title;
    if (command.action === 'status') {
      let response;
      try {
        response = await this._request(hostOperation('status', protocol), {}, undefined, node);
      } catch (_) {
        return { answer: `${n.flag} ${title} (${n.country}) недоступен для диагностики.`, buttons: protocolButtons(protocol, node) };
      }
      if (response.result.state !== 'succeeded') return { answer: `${n.flag} ${title} (${n.country}) недоступен для диагностики.`, buttons: protocolButtons(protocol, node) };
      const data = response.result.data || {};
      const state = data.serviceState === 'active' && data.configValid && data.listenerReady ? 'работает' : 'требует внимания';
      return { answer: `${n.flag} ${title} (${n.country}) ${state}. Клиентов: ${Number(data.clientCount) || 0}. Конфигурация: ${data.configValid ? 'OK' : 'ошибка'}, порт: ${data.listenerReady ? 'слушает' : 'не слушает'}.`, buttons: protocolButtons(protocol, node) };
    }
    const clients = await this._clients(protocol, node);
    return {
      answer: clients.length ? `${n.flag} ${title}-доступы (${n.country}): ${clients.length}. Выбери нужный:` : `${n.flag} ${title}-доступов (${n.country}) пока нет.`,
      buttons: [
        ...clients.map((client) => [{ text: String(client.label || '').slice(0, 40), data: `vpn:${n.code}:${PROTOCOLS[protocol].code}:client:${client.id}` }]),
        ...backButton(protocol, node),
      ],
    };
  }

  async _clients(protocol, node = 'de') {
    const response = await this._request(hostOperation('clients', protocol), {}, undefined, node);
    if (response.result.state !== 'succeeded') throw publicError('VPN_CLIENTS_UNAVAILABLE');
    return (Array.isArray(response.result.data?.clients) ? response.result.data.clients : [])
      .filter((client) => CLIENT_ID_RE.test(String(client.id || '')) && LABEL_RE.test(String(client.label || '')))
      .slice(0, 50);
  }

  async _resolveClient(label, protocol, node = 'de') {
    const normalized = String(label || '').trim();
    if (!LABEL_RE.test(normalized) || normalized.includes('..')) throw publicError('VPN_LABEL_INVALID');
    const matches = (await this._clients(protocol, node)).filter((client) => String(client.label).localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0);
    if (matches.length !== 1) throw publicError(matches.length ? 'VPN_CLIENT_LABEL_AMBIGUOUS' : 'VPN_CLIENT_NOT_FOUND');
    return matches[0];
  }

  async _create(command, context) {
    const protocol = normalizeProtocol(command.protocol);
    const node = normalizeNode(command.node || 'de');
    let rawArgs = { ...command.arguments, protocol, node };
    if (['revoke', 'rotate', 'export'].includes(command.action) && !rawArgs.clientId) {
      const client = await this._resolveClient(rawArgs.label, protocol, node);
      rawArgs = { clientId: client.id, protocol, node };
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

  async _probeBinding(sourceNode, protocol) {
    const normalizedSource = normalizeNode(sourceNode);
    const normalizedProtocol = normalizeProtocol(protocol);
    const expected = normalizedSource === 'de'
      ? (normalizedProtocol === 'vless' ? 'Probe NL to DE VLESS' : 'Probe NL to DE Hysteria')
      : (normalizedProtocol === 'vless' ? 'Probe DE to NL VLESS' : 'Probe DE to NL Hysteria');
    const clients = await this._clients(normalizedProtocol, normalizedSource);
    const matches = clients.filter((item) => item.label === expected);
    if (matches.length !== 1) throw publicError('PROBE_BINDING_INVALID');
    return validateAction('probe.install', {
      sourceNode: normalizedSource,
      runnerNode: normalizedSource === 'de' ? 'nl' : 'de',
      protocol: normalizedProtocol,
      clientId: matches[0].id,
      label: expected,
    });
  }

  async _probeMenu() {
    const resolved = await Promise.allSettled([
      this._probeBinding('de', 'vless'), this._probeBinding('de', 'hysteria2'),
      this._probeBinding('nl', 'vless'), this._probeBinding('nl', 'hysteria2'),
    ]);
    const bindings = resolved.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    const canEnable = typeof this.repository.hasVerifiedProbeBindings === 'function'
      && await this.repository.hasVerifiedProbeBindings();
    return {
      answer: [
        '🧪 **Внешние проверки VPN**',
        'Каждая операция требует отдельного подтверждения владельца. URI тестовых ключей не выводятся и не сохраняются в Jarvis.',
        bindings.length === 4
          ? (canEnable ? 'Все четыре разовые проверки подтверждены. Таймеры можно включить отдельным действием.' : 'Сначала установи и проверь все четыре направления, затем отдельно включи таймеры.')
          : `Доступно направлений: ${bindings.length} из 4. Недостающие тестовые устройства нужно создать или проверить отдельно.`,
      ].join('\n'),
      buttons: [
        ...bindings.map((binding) => [{
          text: `Установить: ${NODES[binding.runnerNode].flag} → ${NODES[binding.sourceNode].flag} ${PROTOCOLS[binding.protocol].title}`,
          data: `vpn:probe:install:${binding.sourceNode}:${PROTOCOLS[binding.protocol].code}`,
        }]),
        ...bindings.map((binding) => [{
          text: `Обновить ключ: ${NODES[binding.runnerNode].flag} → ${NODES[binding.sourceNode].flag} ${PROTOCOLS[binding.protocol].title}`,
          data: `vpn:probe:rotate:${binding.sourceNode}:${PROTOCOLS[binding.protocol].code}`,
        }]),
        [{ ...(canEnable ? { text: '▶️ Включить таймеры', data: 'vpn:probe:enable' } : { text: '⏹ Отключить таймеры', data: 'vpn:probe:disable' }) }, ...(canEnable ? [{ text: '⏹ Отключить таймеры', data: 'vpn:probe:disable' }] : [])],
        [{ text: '← В меню VPN', data: 'vpn:menu' }],
      ],
    };
  }

  async _decideProbe(record, context) {
    let data;
    try {
      if (record.action === 'probe.install') data = await this.probeWorkflow.install(record.arguments);
      else if (record.action === 'probe.rotate') data = await this.probeWorkflow.rotate(record.arguments);
      else if (record.action === 'probe.enable') data = await this.probeWorkflow.enable();
      else data = await this.probeWorkflow.disable();
    } catch (error) {
      const code = error instanceof ProbeWorkflowError ? error.code : 'PROBE_WORKFLOW_UNAVAILABLE';
      const unknown = code.endsWith('_UNKNOWN') || code === 'PROBE_WORKFLOW_UNAVAILABLE';
      await this.repository.complete({ requestId: record.id, status: unknown ? 'unknown' : 'failed', errorCode: code });
      await this.repository.audit({ userId: context.userId, requestId: record.id, type: 'vpn.action.failed', metadata: { action: record.action, errorCode: code } });
      return {
        answer: unknown ? 'Результат внешней проверки пока неизвестен; повторно она не запускалась.' : `Внешняя проверка не выполнена: ${code}.`,
        buttons: [[{ text: '← Внешние проверки', data: 'vpn:probe:menu' }]],
      };
    }
    const metadata = safeProbeWorkflowData(data);
    await this.repository.complete({ requestId: record.id, status: 'succeeded', result: metadata });
    await this.repository.audit({ userId: context.userId, requestId: record.id, type: 'vpn.action.succeeded', metadata: { action: record.action, ...metadata } });
    const answer = record.action === 'probe.enable' ? 'Периодические внешние проверки включены.'
      : record.action === 'probe.disable' ? 'Периодические внешние проверки отключены. VPN-службы и пользовательские ключи не менялись.'
      : `Разовая внешняя проверка ${NODES[metadata.runnerNode].flag} → ${NODES[metadata.targetNode].flag} (${PROTOCOLS[metadata.protocol].title}) завершена.`;
    return { answer, buttons: [[{ text: '← Внешние проверки', data: 'vpn:probe:menu' }]] };
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
    if (record.action === 'subscription.repair') return this._decideSubscriptionRepair(record, context);
    if (record.action.startsWith('probe.')) return this._decideProbe(record, context);
    const node = normalizeNode(record.arguments?.node || 'de');
    const protocol = normalizeProtocol(record.arguments?.protocol);
    const operation = hostOperation(record.action, protocol);
    const hostArguments = { ...(record.arguments || {}) };
    delete hostArguments.protocol;
    delete hostArguments.node;
    let response;
    try {
      response = await this._request(operation, hostArguments, record.id, node);
    } catch (_) {
      await this.repository.complete({ requestId: record.id, status: 'unknown', errorCode: 'HOST_AGENT_UNREACHABLE' });
      return { answer: 'Результат VPN-действия пока неизвестен; повторно оно не запущено.', buttons: protocolButtons(protocol, node) };
    }
    const success = response.result.state === 'succeeded';
    const metadata = safeHostData(response.result.data || {});
    await this.repository.complete({ requestId: record.id, status: success ? 'succeeded' : response.result.state === 'unknown' ? 'unknown' : 'failed', result: metadata, errorCode: response.result.errorCode || null });
    await this.repository.audit({ userId: context.userId, requestId: record.id, type: success ? 'vpn.action.succeeded' : 'vpn.action.failed', metadata: { action: record.action, protocol, node, errorCode: response.result.errorCode || null } });
    if (!success) {
      const errorCode = response.result.errorCode;
      const isLabelExists = errorCode === 'VPN_CLIENT_LABEL_EXISTS';
      const code = PROTOCOLS[protocol].code;
      const n = NODES[node];
      const buttons = isLabelExists
        ? [
            [{ text: '👥 Мои доступы', data: `vpn:${n.code}:${code}:clients` }],
            [{ text: '➕ Новый доступ', data: `vpn:${n.code}:${code}:new` }],
            [{ text: '← В меню VPN', data: `vpn:${n.code}:${code}:menu` }],
          ]
        : protocolButtons(protocol, node);
      return { answer: humanErrorMessage(errorCode, { protocol, label: record.arguments?.label }), buttons };
    }
    const artifact = artifactFrom(response.result.data, node);
    const answer = formatConnectionAnswer(protocol, record.action, response.result.data, node);
    return { answer, ...(artifact ? { artifact } : {}), buttons: protocolButtons(protocol, node) };
  }

  async handleCallback(context) {
    const callback = parseVpnCallback(context.data);
    if (!callback) return null;
    await this._requireOwner(context.userId);
    const node = callback.node || 'de';
    if (callback.action === 'probe-menu') return this._probeMenu();
    if (callback.action === 'probe-install' || callback.action === 'probe-rotate') {
      const binding = await this._probeBinding(callback.sourceNode, callback.protocol);
      return this._create({ action: callback.action === 'probe-install' ? 'probe.install' : 'probe.rotate', arguments: binding }, context);
    }
    if (callback.action === 'probe-enable' || callback.action === 'probe-disable') {
      return this._create({ action: callback.action === 'probe-enable' ? 'probe.enable' : 'probe.disable', arguments: {} }, context);
    }
    if (callback.action === 'country') {
      const n = NODES[normalizeNode(node)];
      return {
        answer: `Выбери протокол для ${n.flag} ${n.country} (${n.city}):`,
        buttons: countryProtocolButtons(node),
      };
    }
    if (callback.action === 'pc') {
      const protocol = callback.protocol || 'hysteria2';
      return {
        answer: buildPcSetupGuide(protocol),
        buttons: protocolButtons(protocol, node),
      };
    }
    if (callback.action === 'routing') {
      return {
        answer: buildRoutingSummary(),
        artifact: buildRoutingArtifact(),
        buttons: [
          [{ text: '🚀 Активировать в Happ (1 клик)', url: 'https://jarvis.rilora.ru/happ-routing' }],
          ...protocolButtons(callback.protocol || 'hysteria2', node),
        ],
      };
    }
    if (callback.action === 'sub-menu') return this._renderSubscriptionMenu(context);
    if (callback.action === 'sub-view') return this._renderSubscriptionView(callback.subscriptionId, context);
    if (callback.action === 'sub-new') return this._createSubscription(context);
    if (callback.action === 'sub-rotate') return this._rotateSubscription(callback.subscriptionId, context);
    if (callback.action === 'sub-revoke') return this._revokeSubscription(callback.subscriptionId, context);
    if (callback.action === 'sub-repair') return this._createSubscriptionRepair(callback.subscriptionId, context);

    if (callback.action === 'menu') {
      return callback.protocol
        ? { answer: renderProtocolGreeting(callback.protocol, node), buttons: protocolButtons(callback.protocol, node) }
        : { answer: 'Выберите страну для отдельного VPN-доступа или откройте подписки Happ:', buttons: menuButtons() };
    }
    if (callback.action === 'protocol') return { answer: renderProtocolGreeting(callback.protocol, node), buttons: protocolButtons(callback.protocol, node) };
    if (callback.action === 'health') return this._read({ action: 'health', protocol: 'both' });
    if (callback.action === 'status') return this._read({ action: 'status', protocol: callback.protocol, node });
    if (callback.action === 'clients') return this._read({ action: 'clients', protocol: callback.protocol, node });
    if (callback.action === 'new') {
      const n = NODES[normalizeNode(node)];
      return {
        answer: `Как назвать новый ${PROTOCOLS[callback.protocol].title}-доступ (${n.flag} ${n.country})? Например: iPhone Максима`,
        requestInput: { kind: 'vpn_access_label', context: { protocol: callback.protocol, node: n.code } },
      };
    }
    if (callback.action === 'restart') return this._create({ action: 'restart', protocol: callback.protocol, node, arguments: {} }, context);
    if (callback.action === 'client') {
      const client = (await this._clients(callback.protocol, node)).find((item) => item.id === callback.clientId);
      if (!client) throw publicError('VPN_CLIENT_NOT_FOUND');
      const code = PROTOCOLS[callback.protocol].code;
      const n = NODES[normalizeNode(node)];
      return {
        answer: `${PROTOCOLS[callback.protocol].title}-доступ «${client.label}» (${n.flag} ${n.country}). Выбери действие:`,
        buttons: [
          [{ text: '📄 Получить конфиг', data: `vpn:${n.code}:${code}:export:${client.id}` }],
          [{ text: '🔁 Перевыпустить', data: `vpn:${n.code}:${code}:rotate:${client.id}` }, { text: '🗑 Отозвать', data: `vpn:${n.code}:${code}:revoke:${client.id}` }],
          [{ text: '← К доступам', data: `vpn:${n.code}:${code}:clients` }],
        ],
      };
    }
    if (['export', 'rotate', 'revoke'].includes(callback.action)) {
      const client = (await this._clients(callback.protocol, node)).find((item) => item.id === callback.clientId);
      if (!client) throw publicError('VPN_CLIENT_NOT_FOUND');
      return this._create({ action: callback.action, protocol: callback.protocol, node, arguments: { clientId: client.id, label: client.label } }, context);
    }
    return this._decide({ decision: callback.action, requestId: callback.requestId }, context);
  }

  async handle(context) {
    const command = parseVpnCommand(context.text);
    if (!command) return null;
    await this._requireOwner(context.userId);
    const node = command.node || 'de';
    if (command.kind === 'pc') {
      const protocol = command.protocol || 'hysteria2';
      return {
        answer: buildPcSetupGuide(protocol),
        buttons: protocolButtons(protocol, node),
      };
    }
    if (command.kind === 'menu') return { answer: 'Выберите страну подключения:', buttons: menuButtons() };
    if (command.kind === 'subscription') return this._renderSubscriptionMenu(context);
    if (command.kind === 'routing') {
      return {
        answer: buildRoutingSummary(),
        artifact: buildRoutingArtifact(),
        buttons: [
          [{ text: '🚀 Активировать в Happ (1 клик)', url: 'https://jarvis.rilora.ru/happ-routing' }],
          ...protocolButtons(command.protocol || 'hysteria2', node),
        ],
      };
    }
    if (command.kind === 'invalid') return { answer: 'Открой /vpn и используй кнопки.', buttons: menuButtons() };
    if (command.kind === 'read') return this._read(command);
    if (command.kind === 'change') return this._create(command, context);
    return this._decide(command, context);
  }

  async _renderSubscriptionMenu(context) {
    if (!this.subscriptionService) {
      return {
        answer: 'Сервис подписок временно недоступен.',
        buttons: [[{ text: '« Главное меню', data: 'vpn:menu' }]],
      };
    }
    const subs = await this.subscriptionService.listSubscriptions(context.userId, { activeOnly: true });
    if (!subs.length) {
      return {
        answer: '📲 **Подписки Jarvis VPN**\n\n' +
          'Одна подписка добавляет в Happ четыре сервера: Германию и Нидерланды через Hysteria 2 и VLESS. Список серверов обновляется в Happ по ссылке подписки.\n\n' +
          'Подписок пока нет. Создайте профиль, затем подтвердите выпуск доступов — бот выдаст ссылку и кнопку для Happ.',
        buttons: [
          [{ text: '➕ Создать подписку', data: 'vpn:sub:new' }],
          [{ text: '« Главное меню', data: 'vpn:menu' }],
        ],
      };
    }

    return {
      answer: `📲 **Ваши подписки (${subs.length})**\n\n` +
        'В каждом профиле — четыре сервера. Откройте профиль, чтобы получить ссылку для Happ или управлять подпиской.',
      buttons: [
        ...subs.map((s) => [{ text: `📱 ${s.label}`, data: `vpn:sub:view:${s.id}` }]),
        [{ text: '➕ Новая подписка', data: 'vpn:sub:new' }],
        [{ text: '« Главное меню', data: 'vpn:menu' }],
      ],
    };
  }

  async _renderSubscriptionView(id, context, existingSub = null) {
    if (!this.subscriptionService) {
      return { answer: 'Сервис подписок временно недоступен.', buttons: [[{ text: '« Главное меню', data: 'vpn:menu' }]] };
    }
    const sub = existingSub || (await this.subscriptionService.repository?.findById(id));
    if (!sub || sub.revokedAt || (sub.userId && sub.userId !== context.userId)) {
      return {
        answer: 'Подписка не найдена или отозвана.',
        buttons: [[{ text: '« К подпискам', data: 'vpn:sub:menu' }]],
      };
    }

    const isBound = this.subscriptionService.hasCompleteClientBinding?.(sub);
    if (!isBound) {
      return {
        answer: `📲 **${sub.label}**\n\n` +
          'Профиль создан, но серверные доступы ещё не выпущены. Подписка пока не готова к добавлению в Happ.\n\n' +
          'Нажмите «Подключить 4 сервера» и подтвердите действие. После успешного выпуска бот пришлёт ссылку.',
        buttons: [
          [{ text: '🔐 Подключить 4 сервера', data: `vpn:sub:repair:${sub.id}` }],
          [{ text: '🗑 Отозвать подписку', data: `vpn:sub:revoke:${sub.id}` }],
          [{ text: '« К подпискам', data: 'vpn:sub:menu' }],
        ],
      };
    }
    return {
      answer: `📲 **${sub.label}**\n\n` +
        'Серверы подключены: 🇩🇪 Германия и 🇳🇱 Нидерланды, Hysteria 2 и VLESS. Одна ссылка добавляет все четыре варианта в Happ.\n\n' +
        'Если профиль уже добавлен в Happ, обновите подписку в самом приложении — серверы загрузятся по прежней ссылке.\n\n' +
        'Если ссылка потеряна или нужна для другого устройства, выпустите новую. После этого старую ссылку придётся заменить в Happ на всех устройствах.',
      buttons: [
        [{ text: '🔗 Получить новую ссылку', data: `vpn:sub:rotate:${sub.id}` }],
        [{ text: '🗑 Отозвать подписку', data: `vpn:sub:revoke:${sub.id}` }],
        [{ text: '« К подпискам', data: 'vpn:sub:menu' }],
      ],
    };
  }

  async _createSubscription(context) {
    if (!this.subscriptionService) {
      return { answer: 'Сервис подписок временно недоступен.', buttons: [[{ text: '« Главное меню', data: 'vpn:menu' }]] };
    }
    const created = await this.subscriptionService.createSubscription({
      userId: context.userId,
      label: 'Мой телефон',
      createdBy: context.userId,
    });
    return {
      answer: `📲 **Профиль «${created.label}» создан**\n\n` +
        'Остался один шаг: подключить четыре сервера. Подтвердите выпуск доступов, и бот пришлёт ссылку для Happ. Пока подключение не завершено, профиль в Happ добавлять не нужно.',
      buttons: [
        [{ text: '🔐 Подключить 4 сервера', data: `vpn:sub:repair:${created.id}` }],
        [{ text: '🗑 Отозвать', data: `vpn:sub:revoke:${created.id}` }],
        [{ text: '« К подпискам', data: 'vpn:sub:menu' }],
      ],
    };
  }

  async _createSubscriptionRepair(subscriptionId, context) {
    const sub = await this.subscriptionService?.repository?.findById(subscriptionId);
    if (!sub || sub.revokedAt || sub.userId !== context.userId) return { answer: 'Подписка не найдена или отозвана.', buttons: [[{ text: '« К подпискам', data: 'vpn:sub:menu' }]] };
    if (this.subscriptionService.hasCompleteClientBinding(sub)) return { answer: 'Четыре сервера уже подключены. Если ссылка потеряна, откройте профиль и нажмите «Получить новую ссылку».', buttons: [[{ text: '« К подписке', data: `vpn:sub:view:${sub.id}` }]] };
    if (await this.repository.hasUnresolvedSubscriptionRepair({ userId: context.userId, subscriptionId })) return { answer: 'Восстановление этой подписки уже ожидает подтверждения или проверки результата. Повторный выпуск доступов заблокирован.', buttons: [[{ text: '« К подписке', data: `vpn:sub:view:${sub.id}` }]] };
    const id = crypto.randomUUID();
    const args = { subscriptionId };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ action: 'subscription.repair', args })).digest();
    const record = await this.repository.create({
      id, userId: context.userId, conversationId: context.conversationId, originChannel: context.originChannel,
      originDeviceId: context.originDeviceId || null, action: 'subscription.repair', arguments: args, fingerprint,
      expiresAt: new Date(this.now().getTime() + CONFIRMATION_TTL_MS),
    });
    return {
      answer: `Подключить четыре сервера к профилю «${sub.label}»? После подтверждения бот выпустит доступы и пришлёт новую ссылку для Happ.`,
      buttons: [[{ text: '✅ Подтвердить', data: `vpn:confirm:${record.id}` }, { text: '✖️ Отмена', data: `vpn:reject:${record.id}` }]],
    };
  }

  async _decideSubscriptionRepair(record, context) {
    const sub = await this.subscriptionService?.repository?.findById(record.arguments?.subscriptionId);
    if (!sub || sub.revokedAt || sub.userId !== context.userId) {
      await this.repository.complete({ requestId: record.id, status: 'failed', errorCode: 'SUBSCRIPTION_NOT_FOUND' });
      return { answer: 'Подписка не найдена или отозвана.', buttons: [[{ text: '« К подпискам', data: 'vpn:sub:menu' }]] };
    }
    if (this.subscriptionService.hasCompleteClientBinding(sub)) {
      await this.repository.complete({ requestId: record.id, status: 'failed', errorCode: 'SUBSCRIPTION_ALREADY_BOUND' });
      return { answer: 'Четыре сервера уже подключены. Откройте профиль, чтобы получить новую ссылку.', buttons: [[{ text: '« К подписке', data: `vpn:sub:view:${sub.id}` }]] };
    }
    const clientIds = { de: {}, nl: {} };
    const issued = [];
    const label = `Подписка ${sub.id.slice(0, 8)}`;
    try {
      for (const [node, protocol] of [['de', 'hysteria2'], ['de', 'vless'], ['nl', 'hysteria2'], ['nl', 'vless']]) {
        const response = await this._request(hostOperation('issue', protocol), { label }, crypto.randomUUID(), node);
        const clientId = response?.result?.state === 'succeeded' ? response.result.data?.client?.id : null;
        if (!CLIENT_ID_RE.test(String(clientId || ''))) throw new Error(response?.result?.state === 'unknown' ? 'UNKNOWN' : 'ISSUE_FAILED');
        clientIds[node][protocol === 'hysteria2' ? 'hy2' : 'vless'] = clientId;
        issued.push({ node, protocol, clientId });
      }
      const bound = await this.subscriptionService.bindClientIds({ subscriptionId: sub.id, userId: context.userId, clientIds });
      if (!bound) throw new Error('BIND_FAILED');
      await this.repository.complete({ requestId: record.id, status: 'succeeded', result: { subscriptionId: sub.id, repairedNodes: ['de', 'nl'] } });
      await this.repository.audit({ userId: context.userId, requestId: record.id, type: 'vpn.subscription.repaired', metadata: { subscriptionId: sub.id } });
    } catch (error) {
      // A transport error may mean the host applied the mutation. Never issue
      // compensating revokes or a second repair until an operator reconciles it.
      let unknown = error?.message === 'UNKNOWN' || error?.message !== 'ISSUE_FAILED';
      if (!unknown) {
        for (const item of issued) {
          try {
            const response = await this._request(hostOperation('revoke', item.protocol), { clientId: item.clientId }, crypto.randomUUID(), item.node);
            if (response?.result?.state !== 'succeeded') unknown = true;
          } catch (_) { unknown = true; }
        }
      }
      await this.repository.complete({ requestId: record.id, status: unknown ? 'unknown' : 'failed', errorCode: unknown ? 'SUBSCRIPTION_REPAIR_UNKNOWN' : 'SUBSCRIPTION_REPAIR_FAILED' });
      return { answer: unknown ? 'Результат восстановления неизвестен. Повторный выпуск заблокирован до проверки администратором; старую ссылку не удаляйте.' : 'Не удалось восстановить доступы; выпущенные доступы отозваны. Попробуйте ещё раз позже.', buttons: [[{ text: '« К подписке', data: `vpn:sub:view:${sub.id}` }]] };
    }
    try {
      const link = await this.subscriptionService.rotateSubscription({ id: sub.id, userId: context.userId });
      if (!link) throw new Error('SUBSCRIPTION_LINK_UNAVAILABLE');
      return {
        answer: `✅ **Четыре сервера подключены к профилю «${sub.label}»**\n\n` +
          `Ссылка для Happ:\n\`${link.url}\`\n\n` +
          'Нажмите кнопку ниже, чтобы открыть Happ, или скопируйте ссылку вручную. В Happ это одна подписка с четырьмя серверами. Для обновления списка позже используйте кнопку обновления в Happ.',
        historyAnswer: `Четыре сервера подключены к профилю «${sub.label}». Ссылка выдана в Telegram без сохранения в истории Jarvis.`,
        buttons: [
          [{ text: '🚀 Открыть в Happ', url: link.happUrl }],
          [{ text: '« К профилю', data: `vpn:sub:view:${sub.id}` }],
        ],
      };
    } catch (_) {
      return {
        answer: '✅ Четыре сервера подключены, но ссылку сейчас выдать не удалось. Откройте профиль и нажмите «Получить новую ссылку».',
        buttons: [[{ text: '🔗 Получить новую ссылку', data: `vpn:sub:rotate:${sub.id}` }]],
      };
    }
  }

  async _rotateSubscription(id, context) {
    if (!this.subscriptionService) {
      return { answer: 'Сервис подписок временно недоступен.', buttons: [[{ text: '« Главное меню', data: 'vpn:menu' }]] };
    }
    const sub = await this.subscriptionService.repository?.findById(id);
    if (!sub || sub.revokedAt || sub.userId !== context.userId) return { answer: 'Профиль не найден или отозван.', buttons: [[{ text: '« К подпискам', data: 'vpn:sub:menu' }]] };
    if (!this.subscriptionService.hasCompleteClientBinding(sub)) return { answer: 'Сначала подключите четыре сервера к профилю. После этого бот выдаст ссылку.', buttons: [[{ text: '« К профилю', data: `vpn:sub:view:${id}` }]] };
    const rotated = await this.subscriptionService.rotateSubscription({ id, userId: context.userId });
    if (!rotated) {
      return { answer: 'Не удалось обновить подписку. Возможно, она была отозвана.', buttons: [[{ text: '« К подпискам', data: 'vpn:sub:menu' }]] };
    }
    return {
      answer: `🔗 **Новая ссылка для «${rotated.label}»**\n\n` +
        `\`${rotated.url}\`\n\n` +
        'Нажмите «Открыть в Happ» или скопируйте ссылку. Предыдущая ссылка больше не работает: замените её в Happ на каждом устройстве, где она была добавлена.',
      historyAnswer: `Новая ссылка для профиля «${rotated.label}» выдана в Telegram без сохранения в истории Jarvis.`,
      buttons: [
        [{ text: '🚀 Открыть в Happ', url: rotated.happUrl }],
        [{ text: '« К профилю', data: `vpn:sub:view:${id}` }],
      ],
    };
  }

  async _revokeSubscription(id, context) {
    if (!this.subscriptionService) {
      return { answer: 'Сервис подписок временно недоступен.', buttons: [[{ text: '« Главное меню', data: 'vpn:menu' }]] };
    }
    const revoked = await this.subscriptionService.revokeSubscription({ id, userId: context.userId });
    if (!revoked) return { answer: 'Профиль уже отозван или не найден.', buttons: [[{ text: '« К подпискам', data: 'vpn:sub:menu' }]] };
    return {
      answer: '🗑 **Подписка отозвана.**\n\nЕё ссылка больше не выдаёт обновления. Уже импортированные отдельные конфигурации серверов могут продолжать работать; отзыв подписки сам по себе не отзывает VPN-ключи.',
      buttons: [[{ text: '« К подпискам', data: 'vpn:sub:menu' }]],
    };
  }

  async openMenu(context) {
    await this._requireOwner(context.userId);
    return { answer: 'Выберите страну для отдельного VPN-доступа или откройте подписки Happ:', buttons: menuButtons() };
  }

  async requestAction({ action, protocol, node = 'de', arguments: actionArguments = {}, ...context }) {
    await this._requireOwner(context.userId);
    return this._create({ action, protocol, node, arguments: actionArguments }, context);
  }
}

module.exports = {
  CONFIRMATION_TTL_MS,
  NODES,
  PROTOCOLS,
  VpnCommandService,
  artifactFrom,
  backButton,
  buildPcSetupGuide,
  countryProtocolButtons,
  formatConnectionAnswer,
  isVpnCallback,
  menuButtons,
  normalizeNode,
  parseVpnCallback,
  parseVpnCommand,
  protocolButtons,
  safeHostData,
  validateAction,
};
