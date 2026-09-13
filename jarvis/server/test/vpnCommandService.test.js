const assert = require('node:assert/strict');
const test = require('node:test');
const { VpnCommandService, artifactFrom, parseVpnCallback, parseVpnCommand, safeHostData, validateAction } = require('../src/vpn/vpnCommandService');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

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
      if (!row || row.originChannel !== input.originChannel || (row.originDeviceId || null) !== (input.originDeviceId || null)) return null;
      row.status = 'running'; return row;
    },
    async reject(input) { return this.approve(input); },
    async latestPending() { return [...records.values()].at(-1) || null; },
    async complete(input) { calls.push(['complete', input]); return input; },
    async audit(input) { calls.push(['audit', input]); },
  };
  const client = { async request(input) {
    calls.push(['request', input]);
    if (input.operation.endsWith('status')) return { result: { state: 'succeeded', data: { serviceState: 'active', configValid: true, listenerReady: true, clientCount: 1 } } };
    if (input.operation.endsWith('clients.list')) return { result: { state: 'succeeded', data: { clients: [{ id: 'vpn-0123456789ab', label: 'Phone', createdAt: '2026-09-12T00:00:00Z' }] } } };
    const shareUri = input.operation.startsWith('vpn.hysteria2.') ? 'hy2://secret@vpn.example.test:443/?sni=vpn.example.test' : 'vless://secret@example.test:443?security=reality';
    return { result: { state: 'succeeded', data: { client: { id: 'vpn-0123456789ab', label: 'Phone', createdAt: '2026-09-12T00:00:00Z' }, shareUri } } };
  } };
  return { service: new VpnCommandService({ repository, client, ownerTelegramId: '101', now: () => new Date('2026-09-12T12:00:00Z') }), calls, records };
}

test('parses only the closed VPN command set', () => {
  assert.deepEqual(parseVpnCommand('/vpn'), { kind: 'menu' });
  assert.deepEqual(parseVpnCommand('/vpn_status'), { kind: 'read', action: 'status', protocol: 'vless', arguments: {} });
  assert.deepEqual(parseVpnCommand('/vpn_issue My Phone'), { kind: 'change', action: 'issue', protocol: 'vless', arguments: { label: 'My Phone' } });
  assert.deepEqual(parseVpnCommand('/vpn_hysteria2_issue My Phone'), { kind: 'change', action: 'issue', protocol: 'hysteria2', arguments: { label: 'My Phone' } });
  assert.deepEqual(parseVpnCommand('/vpn_export My Phone'), { kind: 'change', action: 'export', protocol: 'vless', arguments: { label: 'My Phone' } });
  assert.deepEqual(parseVpnCommand('/vpn_confirm'), { kind: 'decision', decision: 'confirm', requestId: null });
  assert.equal(parseVpnCommand('расскажи о погоде'), null);
  assert.equal(parseVpnCommand('/vpn_issue').kind, 'invalid');
  assert.equal(parseVpnCommand('/vpn_shell id').kind, 'invalid');
});

test('parses only bounded VPN callback actions', () => {
  assert.deepEqual(parseVpnCallback('vpn:clients'), { action: 'clients', protocol: 'vless' });
  assert.deepEqual(parseVpnCallback('vpn:export:vpn-0123456789ab'), { action: 'export', protocol: 'vless', clientId: 'vpn-0123456789ab' });
  assert.deepEqual(parseVpnCallback('vpn:p:h'), { action: 'protocol', protocol: 'hysteria2' });
  assert.deepEqual(parseVpnCallback('vpn:h:export:vpn-0123456789ab'), { action: 'export', protocol: 'hysteria2', clientId: 'vpn-0123456789ab' });
  assert.deepEqual(parseVpnCallback(`vpn:confirm:${REQUEST_ID}`), { action: 'confirm', requestId: REQUEST_ID });
  assert.equal(parseVpnCallback('ops:allow:anything'), null);
  assert.equal(parseVpnCallback('vpn:export:../../root'), null);
});

test('rejects unsafe labels and client identifiers', () => {
  assert.throws(() => validateAction('issue', { label: '../../root' }), /VPN_LABEL_INVALID/);
  assert.throws(() => validateAction('revoke', { clientId: 'anything' }), /VPN_CLIENT_ID_INVALID/);
});

test('owner can observe VPN without confirmation', async () => {
  const { service, calls } = harness();
  const result = await service.handle({ text: '/vpn', userId: USER_ID, conversationId: 'conversation', originChannel: 'telegram' });
  assert.match(result.answer, /VPN-протокол/);
  assert.equal(result.buttons.flat().some((button) => button.data === 'vpn:p:h'), true);
  assert.equal(calls.some((call) => call[0] === 'request'), false);
  const status = await service.handleCallback({ userId: USER_ID, originChannel: 'telegram', data: 'vpn:h:status' });
  assert.match(status.answer, /Hysteria2 работает/);
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
  assert.equal(detail.buttons.flat().some((button) => button.data === 'vpn:v:export:vpn-0123456789ab'), true);
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
