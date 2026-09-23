const assert = require('node:assert/strict');
const test = require('node:test');
const { VpnCommandService, artifactFrom, buildPcSetupGuide, formatConnectionAnswer, parseVpnCallback, parseVpnCommand, safeHostData, validateAction } = require('../src/vpn/vpnCommandService');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function defaultHealthData() {
  return {
    host: 'healthy',
    network: { dns: 'healthy', outbound: 'healthy' },
    xray: { service: 'healthy', config: 'healthy', listener: 'healthy', protocolProbe: 'unknown' },
    hysteria2: { service: 'healthy', config: 'healthy', listener: 'healthy', auth: 'healthy', authEndpoint: 'healthy', authCredentialProbe: 'healthy', protocolProbe: 'unknown' },
    diagnosis: { version: 1, state: 'healthy', primary: null, secondarySignals: [
      { code: 'XRAY_PROTOCOL_UNVERIFIED', severity: 'info' },
      { code: 'HYSTERIA2_PROTOCOL_UNVERIFIED', severity: 'info' },
    ] },
  };
}

function harness(options = {}) {
  const records = new Map();
  const calls = [];
  const repository = {
    async isOwner({ userId }) { return options.owner !== false && userId === USER_ID; },
    async create(input) {
      const row = { ...input, id: options.requestId || REQUEST_ID, arguments: input.arguments, status: 'awaiting_confirmation' };
      records.set(row.id, row); return row;
    },
    async approve(input) {
      const row = records.get(input.requestId);
      if (!row || row.status !== 'awaiting_confirmation' || row.originChannel !== input.originChannel
        || (row.originDeviceId || null) !== (input.originDeviceId || null)) return null;
      row.status = 'running'; return row;
    },
    async reject(input) { return this.approve(input); },
    async latestPending() { return [...records.values()].at(-1) || null; },
    async complete(input) { calls.push(['complete', input]); return input; },
    async audit(input) { calls.push(['audit', input]); },
  };
  const client = { async request(input) {
    calls.push(['request', input]);
    if (input.operation === 'vpn.health.snapshot') {
      return {
        result: {
          state: 'succeeded',
          data: options.healthData || defaultHealthData(),
        },
      };
    }
    if (input.operation.endsWith('status')) return { result: { state: 'succeeded', data: { serviceState: 'active', configValid: true, listenerReady: true, clientCount: 1 } } };
    if (input.operation.endsWith('clients.list')) return { result: { state: 'succeeded', data: { clients: [{ id: 'vpn-0123456789ab', label: 'Phone', createdAt: '2026-09-12T00:00:00Z' }] } } };
    const shareUri = input.operation.startsWith('vpn.hysteria2.') ? 'hy2://secret@vpn.example.test:443/?sni=vpn.example.test' : 'vless://secret@example.test:443?security=reality';
    return { result: { state: 'succeeded', data: { client: { id: 'vpn-0123456789ab', label: 'Phone', createdAt: '2026-09-12T00:00:00Z' }, shareUri } } };
  } };
  return { service: new VpnCommandService({ repository, client, ownerTelegramId: '101', now: () => new Date('2026-09-12T12:00:00Z') }), calls, records };
}

test('parses only the closed VPN command set', () => {
  assert.deepEqual(parseVpnCommand('/vpn'), { kind: 'menu' });
  assert.deepEqual(parseVpnCommand('/vpn_health'), { kind: 'read', action: 'health', protocol: 'both', arguments: {} });
  assert.deepEqual(parseVpnCommand('/vpn_snapshot'), { kind: 'read', action: 'health', protocol: 'both', arguments: {} });
  assert.deepEqual(parseVpnCommand('/vpn_status'), { kind: 'read', action: 'status', protocol: 'vless', node: 'de', arguments: {} });
  assert.deepEqual(parseVpnCommand('/vpn_nl_status'), { kind: 'read', action: 'status', protocol: 'vless', node: 'nl', arguments: {} });
  assert.deepEqual(parseVpnCommand('/vpn_issue My Phone'), { kind: 'change', action: 'issue', protocol: 'vless', node: 'de', arguments: { label: 'My Phone' } });
  assert.deepEqual(parseVpnCommand('/vpn_hysteria2_issue My Phone'), { kind: 'change', action: 'issue', protocol: 'hysteria2', node: 'de', arguments: { label: 'My Phone' } });
  assert.deepEqual(parseVpnCommand('/vpn_nl_hysteria2_issue My Phone'), { kind: 'change', action: 'issue', protocol: 'hysteria2', node: 'nl', arguments: { label: 'My Phone' } });
  assert.deepEqual(parseVpnCommand('/vpn_export My Phone'), { kind: 'change', action: 'export', protocol: 'vless', node: 'de', arguments: { label: 'My Phone' } });
  assert.deepEqual(parseVpnCommand('/vpn_routing'), { kind: 'routing', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCommand('/vpn_ru'), { kind: 'routing', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCommand('/vpn_hysteria2_routing'), { kind: 'routing', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCommand('/vpn_pc'), { kind: 'pc', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCommand('/vpn_vless_pc'), { kind: 'pc', protocol: 'vless', node: 'de' });
  assert.deepEqual(parseVpnCommand('/vpn_hysteria2_pc'), { kind: 'pc', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCommand('/vpn_nl_pc'), { kind: 'pc', protocol: 'hysteria2', node: 'nl' });
  assert.deepEqual(parseVpnCommand('/vpn_confirm'), { kind: 'decision', decision: 'confirm', requestId: null });
  assert.equal(parseVpnCommand('расскажи о погоде'), null);
  assert.equal(parseVpnCommand('/vpn_issue').kind, 'invalid');
  assert.equal(parseVpnCommand('/vpn_shell id').kind, 'invalid');
});

test('parses only bounded VPN callback actions', () => {
  assert.deepEqual(parseVpnCallback('vpn:clients'), { action: 'clients', protocol: 'vless', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:health'), { action: 'health', protocol: 'both' });
  assert.deepEqual(parseVpnCallback('vpn:routing'), { action: 'routing', protocol: 'vless', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:h:routing'), { action: 'routing', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:pc'), { action: 'pc', protocol: 'vless', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:h:pc'), { action: 'pc', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:v:pc'), { action: 'pc', protocol: 'vless', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:export:vpn-0123456789ab'), { action: 'export', protocol: 'vless', clientId: 'vpn-0123456789ab', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:p:h'), { action: 'protocol', protocol: 'hysteria2', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:h:export:vpn-0123456789ab'), { action: 'export', protocol: 'hysteria2', clientId: 'vpn-0123456789ab', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:c:de'), { action: 'country', node: 'de' });
  assert.deepEqual(parseVpnCallback('vpn:c:nl'), { action: 'country', node: 'nl' });
  assert.deepEqual(parseVpnCallback('vpn:nl:h:status'), { action: 'status', protocol: 'hysteria2', node: 'nl' });
  assert.deepEqual(parseVpnCallback('vpn:nl:v:export:vpn-0123456789ab'), { action: 'export', protocol: 'vless', clientId: 'vpn-0123456789ab', node: 'nl' });
  assert.deepEqual(parseVpnCallback(`vpn:confirm:${REQUEST_ID}`), { action: 'confirm', requestId: REQUEST_ID });
  assert.deepEqual(parseVpnCallback('vpn:probe:menu'), { action: 'probe-menu' });
  assert.deepEqual(parseVpnCallback('vpn:probe:install:de:v'), { action: 'probe-install', sourceNode: 'de', protocol: 'vless' });
  assert.deepEqual(parseVpnCallback('vpn:probe:recheck:nl:h'), { action: 'probe-recheck', sourceNode: 'nl', protocol: 'hysteria2' });
  assert.equal(parseVpnCallback('vpn:probe:recheck:xx:v'), null);
  assert.deepEqual(parseVpnCallback('vpn:probe:disable'), { action: 'probe-disable' });
  assert.equal(parseVpnCallback('ops:allow:anything'), null);
  assert.equal(parseVpnCallback('vpn:export:../../root'), null);
});

test('rejects unsafe labels and client identifiers', () => {
  assert.throws(() => validateAction('issue', { label: '../../root' }), /VPN_LABEL_INVALID/);
  assert.throws(() => validateAction('revoke', { clientId: 'anything' }), /VPN_CLIENT_ID_INVALID/);
  assert.deepEqual(validateAction('probe.recheck', { sourceNode: 'de', runnerNode: 'nl', protocol: 'vless' }), {
    sourceNode: 'de', runnerNode: 'nl', protocol: 'vless',
  });
  assert.throws(() => validateAction('probe.recheck', { sourceNode: 'de', runnerNode: 'de', protocol: 'vless' }), /PROBE_BINDING_INVALID/);
});

test('owner can observe VPN without confirmation', async () => {
  const { service, calls } = harness();
  const result = await service.handle({ text: '/vpn', userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' });
  assert.match(result.answer, /Выберите страну подключения/);
  assert.equal(result.buttons.flat().some((button) => button.data === 'vpn:c:de'), true);
  assert.equal(result.buttons.flat().some((button) => button.data === 'vpn:c:nl'), true);
  assert.equal(result.buttons.flat().some((button) => button.data === 'vpn:p:h'), false);
  assert.equal(result.buttons.flat().some((button) => button.data === 'vpn:p:v'), false);
  assert.equal(result.buttons.flat().some((button) => button.data === 'vpn:routing'), false);
  assert.equal(calls.some((call) => call[0] === 'request'), false);

  const h2Menu = await service.handleCallback({ userId: USER_ID, originChannel: 'telegram', data: 'vpn:p:h' });
  assert.match(h2Menu.answer, /Hysteria 2 — основной скоростной VPN/);
  assert.match(h2Menu.answer, /Как настроить за 2 шага/);
  assert.match(h2Menu.answer, /Включить обход РФ/);
  assert.equal(h2Menu.buttons.flat().some((button) => button.data === 'vpn:de:h:routing'), true);

  const status = await service.handleCallback({ userId: USER_ID, originChannel: 'telegram', data: 'vpn:h:status' });
  assert.match(status.answer, /Hysteria2.*работает/);
  assert.equal(calls.find((call) => call[0] === 'request')[1].operation, 'vpn.hysteria2.status');
});

test('non-owner cannot inspect or mutate VPN', async () => {
  const { service } = harness({ owner: false });
  await assert.rejects(service.handle({ text: '/vpn', userId: USER_ID, originChannel: 'telegram' }), (error) => error.publicCode === 'VPN_OWNER_REQUIRED');
});

test('changing action is origin-bound and executes only after confirmation', async () => {
  const { service, calls } = harness();
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'desktop', originDeviceId: DEVICE_ID };
  const created = await service.handle({ ...context, text: '/vpn_issue Phone' });
  assert.equal(created.answer.includes(REQUEST_ID), false);
  assert.equal(created.buttons[0][0].data, `vpn:confirm:${REQUEST_ID}`);
  assert.equal(calls.some((call) => call[0] === 'request'), false);
  await assert.rejects(
    service.handle({ ...context, originDeviceId: '44444444-4444-4444-8444-444444444444', text: `/vpn_confirm ${REQUEST_ID}` }),
    (error) => error.publicCode === 'VPN_CONFIRMATION_UNAVAILABLE',
  );
  const executed = await service.handle({ ...context, text: '/vpn_confirm' });
  assert.equal(executed.artifact.content.startsWith('vless://'), true);
  const request = calls.find((call) => call[0] === 'request');
  assert.equal(request[1].operation, 'vpn.client.issue');
  assert.equal(request[1].requestId, REQUEST_ID);
});

test('client menu hides IDs and label commands resolve internally', async () => {
  const { service, calls } = harness();
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  const list = await service.handle({ ...context, text: '/vpn_clients' });
  assert.equal(list.answer.includes('vpn-0123456789ab'), false);
  assert.equal(list.buttons[0][0].text, 'Phone');
  const detail = await service.handleCallback({ ...context, data: list.buttons[0][0].data });
  assert.equal(detail.answer.includes('vpn-0123456789ab'), false);
  assert.equal(detail.buttons.flat().some((button) => button.data === 'vpn:de:v:export:vpn-0123456789ab'), true);
  const created = await service.handle({ ...context, text: '/vpn_export Phone' });
  assert.equal(created.answer.includes('vpn-0123456789ab'), false);
  assert.equal(calls.filter((call) => call[0] === 'request').at(-1)[1].operation, 'vpn.clients.list');
});

test('secret host fields are excluded from persistence metadata', () => {
  const data = { client: { id: 'vpn-0123456789ab', label: 'Phone', createdAt: 'now', uuid: 'secret' }, shareUri: 'vless://secret', privateKey: 'private' };
  const safe = safeHostData(data);
  assert.equal(JSON.stringify(safe).includes('secret'), false);
  assert.equal(JSON.stringify(safe).includes('private'), false);
  assert.equal(artifactFrom(data).content, 'vless://secret\n');
  assert.equal(artifactFrom({ ...data, shareUri: 'hy2://secret' }).kind, 'happ-hysteria2');
});

test('probe credential handoff requires the normal owner confirmation and persists only public metadata', async () => {
  const { service, calls, records } = harness();
  service.probeWorkflow = {
    async install() {
      return { targetNode: 'de', runnerNode: 'nl', protocol: 'vless', installedAt: '2026-09-16T12:00:00Z', acceptedCheck: 'vless_tcp_8443', probe: { secret: 'never-persist' } };
    },
  };
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  const binding = {
    sourceNode: 'de', runnerNode: 'nl', protocol: 'vless',
    clientId: 'vpn-0123456789ab', label: 'Probe NL to DE VLESS',
  };
  const created = await service.requestAction({ ...context, action: 'probe.install', arguments: binding });
  assert.match(created.answer, /тестовый ключ VLESS/);
  assert.equal(calls.some(([type]) => type === 'request'), false);
  const decided = await service.handle({ ...context, text: '/vpn_confirm' });
  assert.match(decided.answer, /Разовая внешняя проверка/);
  const stored = records.get(REQUEST_ID);
  assert.equal(JSON.stringify(stored.arguments).includes('vless://'), false);
  const completion = calls.find(([type]) => type === 'complete')[1];
  assert.deepEqual(completion.result, { targetNode: 'de', runnerNode: 'nl', protocol: 'vless', installedAt: '2026-09-16T12:00:00Z', acceptedCheck: 'vless_tcp_8443' });
  assert.equal(JSON.stringify(completion.result).includes('never-persist'), false);
});

test('probe recheck requires a private-chat owner confirmation and calls only the recheck workflow', async () => {
  const { service, calls, records } = harness();
  let rechecks = 0;
  service.probeWorkflow = { async recheck(binding) {
    rechecks += 1;
    assert.deepEqual(binding, { sourceNode: 'de', runnerNode: 'nl', protocol: 'vless' });
    return { targetNode: 'de', runnerNode: 'nl', protocol: 'vless', acceptedCheck: 'vless_tcp_8443' };
  } };
  service._clients = async (protocol, node) => [{
    id: 'vpn-0123456789ab',
    label: node === 'de' ? `Probe NL to DE ${protocol === 'vless' ? 'VLESS' : 'Hysteria'}` : `Probe DE to NL ${protocol === 'vless' ? 'VLESS' : 'Hysteria'}`,
  }];
  const context = { userId: USER_ID, conversationId: 'private-conversation', originChannel: 'telegram', chatType: 'private' };
  const menu = await service.handleCallback({ ...context, data: 'vpn:probe:menu' });
  assert.equal(menu.buttons.flat().some((button) => button.data === 'vpn:probe:recheck:de:v'), true);
  const created = await service.handleCallback({ ...context, data: 'vpn:probe:recheck:de:v' });
  assert.match(created.answer, /Проверить уже установленный тестовый ключ VLESS/);
  const record = records.get(REQUEST_ID);
  assert.deepEqual(record.arguments, { sourceNode: 'de', runnerNode: 'nl', protocol: 'vless' });
  assert.match(created.buttons[0][0].data, /^vpn:confirm:/);
  assert.equal(rechecks, 0);
  const result = await service.handle({ ...context, text: '/vpn_confirm' });
  assert.match(result.answer, /Проверка ключа 🇳🇱 → 🇩🇪 \(VLESS\) завершена успешно/);
  assert.equal(rechecks, 1);
  assert.equal(calls.some(([type]) => type === 'request'), false);
  assert.equal(records.get(REQUEST_ID).status, 'running');
  await assert.rejects(service.handle({ ...context, text: '/vpn_confirm' }),
    (error) => error.publicCode === 'VPN_CONFIRMATION_UNAVAILABLE');
  assert.equal(rechecks, 1);
});

test('probe recheck callback rejects non-private Telegram context', async () => {
  const { service } = harness();
  const context = { userId: USER_ID, conversationId: 'group', originChannel: 'telegram', chatType: 'group' };
  await assert.rejects(service.handleCallback({ ...context, data: 'vpn:probe:recheck:de:v' }),
    (error) => error.publicCode === 'VPN_PRIVATE_CHAT_REQUIRED');
});

test('a probe workflow without accepted proof cannot mark installation successful', async () => {
  const { service, calls } = harness();
  service.probeWorkflow = { async install() { return { targetNode: 'de', runnerNode: 'nl', protocol: 'vless' }; } };
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  const binding = { sourceNode: 'de', runnerNode: 'nl', protocol: 'vless', clientId: 'vpn-0123456789ab', label: 'Probe NL to DE VLESS' };
  await service.requestAction({ ...context, action: 'probe.install', arguments: binding });
  const result = await service.handle({ ...context, text: '/vpn_confirm' });
  assert.doesNotMatch(result.answer, /Разовая внешняя проверка/);
  assert.equal(calls.find(([type]) => type === 'complete')[1].status, 'unknown');
});

test('Hysteria2 confirmation stays protocol-bound and never sends protocol to Host Agent arguments', async () => {
  const { service, calls } = harness();
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  const created = await service.handle({ ...context, text: '/vpn_hysteria2_issue iPhone' });
  assert.match(created.answer, /Hysteria2/);
  const executed = await service.handle({ ...context, text: '/vpn_confirm' });
  const request = calls.find((call) => call[0] === 'request');
  assert.equal(request[1].operation, 'vpn.hysteria2.client.issue');
  assert.deepEqual(request[1].arguments, { label: 'iPhone' });
  assert.equal(executed.artifact.kind, 'happ-hysteria2');
});

test('routing command and callback return split-tunneling summary and artifact', async () => {
  const { service } = harness();
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  const viaCommand = await service.handle({ ...context, text: '/vpn_routing' });
  assert.match(viaCommand.answer, /Раздельная маршрутизация/);
  assert.ok(viaCommand.answer.includes('https://jarvis.rilora.ru/happ-routing'));
  assert.equal(viaCommand.artifact.kind, 'happ-routing');
  assert.equal(viaCommand.artifact.filename, 'jarvis-ru-direct-routing.json');
  assert.ok(viaCommand.buttons.flat().some((b) => b.url === 'https://jarvis.rilora.ru/happ-routing'));

  const viaCallback = await service.handleCallback({ ...context, data: 'vpn:h:routing' });
  assert.match(viaCallback.answer, /Раздельная маршрутизация/);
  assert.equal(viaCallback.artifact.kind, 'happ-routing');
  assert.ok(viaCallback.buttons.flat().some((b) => b.url === 'https://jarvis.rilora.ru/happ-routing'));
});

test('formatConnectionAnswer generates 1-click Happ instructions and code block for keys', () => {
  const data = {
    client: { id: 'vpn-0123456789ab', label: 'iPhone' },
    shareUri: 'hy2://secret@vpn.rilora.ru:443/?obfs=salamander#iPhone',
  };

  const issueAnswer = formatConnectionAnswer('hysteria2', 'issue', data);
  assert.match(issueAnswer, /Hysteria2-доступ «iPhone» создан!/);
  assert.ok(issueAnswer.includes('`hy2://secret@vpn.rilora.ru:443/?obfs=salamander#iPhone`'));
  assert.match(issueAnswer, /Импорт в Happ за 1 клик/);
  assert.match(issueAnswer, /iPhone \/ Android/);
  assert.match(issueAnswer, /ПК \(Windows \/ Mac\)/);
  assert.match(issueAnswer, /Обход РФ/);

  const rotateAnswer = formatConnectionAnswer('hysteria2', 'rotate', data);
  assert.match(rotateAnswer, /перевыпущен/);
  assert.ok(rotateAnswer.includes('`hy2://secret@vpn.rilora.ru:443/?obfs=salamander#iPhone`'));

  const exportAnswer = formatConnectionAnswer('vless', 'export', {
    client: { id: 'vpn-0123456789ab', label: 'Laptop' },
    shareUri: 'vless://secret@example.test:443?security=reality#Laptop',
  });
  assert.match(exportAnswer, /Ключ подключения VLESS «Laptop»/);
  assert.ok(exportAnswer.includes('`vless://secret@example.test:443?security=reality#Laptop`'));

  const revokeAnswer = formatConnectionAnswer('hysteria2', 'revoke', { client: { label: 'Old Phone' } });
  assert.equal(revokeAnswer, 'Hysteria2-доступ «Old Phone» отозван.');

  const restartAnswer = formatConnectionAnswer('hysteria2', 'restart', {});
  assert.equal(restartAnswer, 'Hysteria2 VPN перезапущен.');
});

test('PC guide command and callback return detailed PC setup and troubleshooting instructions', async () => {
  const { service } = harness();
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  const viaCommand = await service.handle({ ...context, text: '/vpn_pc' });
  assert.match(viaCommand.answer, /Настройка Hysteria 2 на ПК/);
  assert.match(viaCommand.answer, /ПОЧЕМУ ПИШЕТ «ПИНГ N\/A»/);
  assert.match(viaCommand.answer, /Запуск от Администратора/);
  assert.match(viaCommand.answer, /Синхронизация времени/);
  assert.ok(viaCommand.buttons.flat().some((b) => b.data === 'vpn:de:h:pc'));

  const viaCallback = await service.handleCallback({ ...context, data: 'vpn:v:pc' });
  assert.match(viaCallback.answer, /Настройка VLESS на ПК/);
  assert.match(viaCallback.answer, /v2rayN/);
  assert.match(viaCallback.answer, /Тест реальной задержки/);
  assert.ok(viaCallback.buttons.flat().some((b) => b.data === 'vpn:de:v:pc'));

  assert.match(buildPcSetupGuide('hysteria2'), /Hiddify/);
  assert.match(buildPcSetupGuide('vless'), /v2rayN/);
});

test('VPN_CLIENT_LABEL_EXISTS failure returns user-friendly guidance and direct access buttons', async () => {
  const { service } = harness();
  service.client.request = async () => ({
    result: { state: 'failed', errorCode: 'VPN_CLIENT_LABEL_EXISTS' },
  });
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  await service.handle({ ...context, text: '/vpn_hysteria2_issue Duplicate' });
  const decided = await service.handle({ ...context, text: '/vpn_confirm' });
  assert.match(decided.answer, /уже существует/);
  assert.match(decided.answer, /Duplicate/);
  assert.ok(decided.buttons.flat().some((b) => b.data === 'vpn:de:h:clients'));
  assert.ok(decided.buttons.flat().some((b) => b.data === 'vpn:de:h:new'));
});

test('health snapshot command and callback return structured overview without secrets', async () => {
  const { service, calls } = harness();
  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };
  const commandResult = await service.handle({ ...context, text: '/vpn_health' });
  assert.match(commandResult.answer, /Health Snapshot/);
  assert.match(commandResult.answer, /Хост VPS: ✅ OK/);
  assert.match(commandResult.answer, /• DNS: ✅ OK/);
  assert.match(commandResult.answer, /• Интернет \(HTTPS\): ✅ OK/);
  assert.match(commandResult.answer, /VLESS \(Xray\):/);
  assert.match(commandResult.answer, /Hysteria 2:/);
  assert.match(commandResult.answer, /Авторизация: ✅ OK/);
  assert.match(commandResult.answer, /Эндпоинт auth: ✅ OK/);
  assert.match(commandResult.answer, /Проверка ключа: ✅ OK/);
  assert.match(commandResult.answer, /Протокол \(Probe\): ❓ Неизвестно \(требуется внешний узел\)/);
  assert.match(commandResult.answer, /Активных VPN-инцидентов нет/);
  assert.match(commandResult.answer, /Автоматический ремонт: отключён/);

  const callbackResult = await service.handleCallback({ ...context, data: 'vpn:health' });
  assert.match(callbackResult.answer, /Health Snapshot/);
  assert.match(callbackResult.answer, /Хост VPS: ✅ OK/);

  const snapshotReq = calls.find(([type, req]) => type === 'request' && req.operation === 'vpn.health.snapshot');
  assert.ok(snapshotReq);
});

test('health snapshot renders only closed incident language and rejects malformed diagnosis', async () => {
  const incident = defaultHealthData();
  incident.hysteria2.auth = 'unavailable';
  incident.hysteria2.authEndpoint = 'unavailable';
  incident.hysteria2.authCredentialProbe = 'unavailable';
  incident.diagnosis = { version: 1, state: 'incident', primary: {
    code: 'HYSTERIA2_AUTH_ENDPOINT_FAILURE', failureKind: 'vpn.hysteria2.auth_endpoint_failure', severity: 'error',
    scope: 'hysteria2', confidence: 'high', likelyCause: 'host_agent_auth_dependency',
    evidence: [{ path: 'hysteria2.service', status: 'healthy' }, { path: 'hysteria2.authEndpoint', status: 'unavailable' }],
    safeNextChecks: ['host_agent_status', 'hysteria_auth_endpoint_probe'],
  }, secondarySignals: defaultHealthData().diagnosis.secondarySignals };
  const rendered = await harness({ healthData: incident }).service.handle({ userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram', text: '/vpn_health' });
  assert.match(rendered.answer, /HYSTERIA2_AUTH_ENDPOINT_FAILURE/);
  assert.match(rendered.answer, /локальная auth-зависимость Host Agent/);
  assert.doesNotMatch(rendered.answer, /password|privateKey|vless:\/\/|hy2:\/\//i);

  const malformed = defaultHealthData();
  malformed.diagnosis.prompt = 'vless://secret';
  const rejected = await harness({ healthData: malformed }).service.handle({ userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram', text: '/vpn_health' });
  assert.equal(rejected.answer, 'Диагностика VPN вернула некорректные данные.');
  assert.doesNotMatch(rejected.answer, /secret/);
});

test('multi-node support routes operations cleanly to DE and NL clients', async () => {
  const deCalls = [];
  const nlCalls = [];
  const deClient = {
    async request(req) {
      deCalls.push(req);
      if (req.operation === 'vpn.hysteria2.status') return { result: { state: 'succeeded', data: { serviceState: 'active', configValid: true, listenerReady: true, clientCount: 3 } } };
      if (req.operation === 'vpn.health.snapshot') return { result: { state: 'succeeded', data: defaultHealthData() } };
      return { result: { state: 'succeeded', data: {} } };
    },
  };
  const nlClient = {
    async request(req) {
      nlCalls.push(req);
      if (req.operation === 'vpn.hysteria2.status') return { result: { state: 'succeeded', data: { serviceState: 'active', configValid: true, listenerReady: true, clientCount: 1 } } };
      if (req.operation === 'vpn.hysteria2.clients.list') return { result: { state: 'succeeded', data: { clients: [{ id: 'vpn-112233445566', label: 'NL Mobile', createdAt: '2026-09-15T00:00:00Z' }] } } };
      if (req.operation === 'vpn.hysteria2.client.issue') return { result: { state: 'succeeded', data: { client: { id: 'vpn-112233445566', label: req.arguments?.label || 'NL Mobile' }, shareUri: 'hy2://secret@94.183.208.56:443?sni=vpn.rilora.ru' } } };
      if (req.operation === 'vpn.health.snapshot') return { result: { state: 'succeeded', data: defaultHealthData() } };
      return { result: { state: 'succeeded', data: {} } };
    },
  };

  const records = new Map();
  const repository = {
    async isOwner() { return true; },
    async create(record) { records.set(record.id, { ...record, status: 'pending' }); return record; },
    async latestPending() { return Array.from(records.values()).find((r) => r.status === 'pending'); },
    async approve({ requestId }) { const r = records.get(requestId); if (r) r.status = 'approved'; return r; },
    async complete({ requestId, status }) { const r = records.get(requestId); if (r) r.status = status; return r; },
    async audit() {},
  };

  const service = new VpnCommandService({
    repository,
    clients: { de: deClient, nl: nlClient },
    ownerTelegramId: '101',
    now: () => new Date('2026-09-16T00:00:00Z'),
  });

  const context = { userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' };

  // 1. Country selection for Netherlands
  const countryMenu = await service.handleCallback({ ...context, data: 'vpn:c:nl' });
  assert.match(countryMenu.answer, /Нидерланды/);
  assert.ok(countryMenu.buttons.flat().some((b) => b.data === 'vpn:nl:h:menu'));
  assert.ok(countryMenu.buttons.flat().some((b) => b.data === 'vpn:nl:v:menu'));

  // 2. Open Hysteria 2 on Netherlands
  const nlH2 = await service.handleCallback({ ...context, data: 'vpn:nl:h:menu' });
  assert.match(nlH2.answer, /Нидерланды/);
  assert.match(nlH2.answer, /Amsterdam/);
  assert.ok(nlH2.buttons.flat().some((b) => b.data === 'vpn:nl:h:status'));
  assert.ok(nlH2.buttons.flat().some((b) => b.data === 'vpn:nl:h:clients'));
  assert.ok(nlH2.buttons.flat().some((b) => b.data === 'vpn:nl:h:new'));

  // 3. Status on Netherlands routes to nlClient
  const nlStatus = await service.handleCallback({ ...context, data: 'vpn:nl:h:status' });
  assert.match(nlStatus.answer, /🇳🇱 Hysteria2 \(Нидерланды\) работает/);
  assert.equal(nlCalls.some((c) => c.operation === 'vpn.hysteria2.status'), true);

  // 4. Clients list on Netherlands routes to nlClient
  const nlClients = await service.handleCallback({ ...context, data: 'vpn:nl:h:clients' });
  assert.match(nlClients.answer, /🇳🇱 Hysteria2-доступы \(Нидерланды\): 1/);
  assert.ok(nlClients.buttons.flat().some((b) => b.data === 'vpn:nl:h:client:vpn-112233445566'));

  // 5. Issue new access on Netherlands
  const issuePrompt = await service.handle({ ...context, text: '/vpn_nl_hysteria2_issue AmsterdamPhone' });
  assert.match(issuePrompt.answer, /Нидерланды/);
  const confirmResult = await service.handle({ ...context, text: '/vpn_confirm' });
  assert.match(confirmResult.answer, /Нидерланды/);
  assert.equal(confirmResult.artifact.filename, 'AmsterdamPhone-nl-hysteria2.txt');
  assert.ok(nlCalls.some((c) => c.operation === 'vpn.hysteria2.client.issue' && c.arguments.label === 'AmsterdamPhone'));

  // 6. Multi-node health snapshot checks both DE and NL
  const multiHealth = await service.handle({ ...context, text: '/vpn_health' });
  assert.match(multiHealth.answer, /Диагностика всех VPN-нод/);
  assert.match(multiHealth.answer, /🇩🇪 \*\*Германия/);
  assert.match(multiHealth.answer, /🇳🇱 \*\*Нидерланды/);
  assert.equal(deCalls.some((c) => c.operation === 'vpn.health.snapshot'), true);
  assert.equal(nlCalls.some((c) => c.operation === 'vpn.health.snapshot'), true);
});
