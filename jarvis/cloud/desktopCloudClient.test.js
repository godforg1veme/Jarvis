const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_CLOUD_SERVER_URL, DesktopCloudClient, VPN_EXPORT_DIR, normalizeServerUrl, toWebSocketUrl } = require('./desktopCloudClient');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } };
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(value, 'utf8').toString('base64'), 'utf8'),
    decryptString: (value) => Buffer.from(String(value), 'base64').toString('utf8'),
  };
}

class FailingSocket {
  constructor() { throw new Error('offline in test'); }
}

class HandshakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.listeners = new Map();
    this.sent = [];
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.listeners.get('close') && this.listeners.get('close')(); }
  emit(name, event = {}) { this.listeners.get(name)(event); }
}

test('cloud client stores the device token separately from its readable state', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    const requests = [];
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      WebSocket: FailingSocket,
      fetch: async (url, options = {}) => {
        requests.push({ url, options });
        return response({ ok: true, device: { id: 'device-a', name: 'Home PC', status: 'offline' }, token: 'x'.repeat(43) }, 201);
      },
    });
    const state = await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    assert.equal(state.deviceId, 'device-a');
    assert.equal(JSON.stringify(state).includes('x'.repeat(43)), false);
    assert.equal(fs.readFileSync(path.join(userDataPath, 'cloud-device.json'), 'utf8').includes('x'.repeat(43)), false);
    assert.equal(fs.readFileSync(path.join(userDataPath, 'cloud-device.token')).toString('utf8').includes('x'.repeat(43)), false);
    assert.equal(requests[0].options.headers.Authorization, undefined);
    client.stopSession();
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('cloud URL normalization rejects an insecure public endpoint and creates a WSS path', () => {
  assert.throws(() => normalizeServerUrl('http://jarvis.example.test'), /HTTPS/);
  assert.equal(normalizeServerUrl('http://127.0.0.1:3210'), 'http://127.0.0.1:3210');
  assert.equal(toWebSocketUrl('https://jarvis.example.test'), 'wss://jarvis.example.test/v1/desktop/session');
});

test('cloud client suggests the production endpoint before pairing', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      WebSocket: FailingSocket,
    });
    assert.equal(client.getState().defaultServerUrl, DEFAULT_CLOUD_SERVER_URL);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('cloud client sends the credential only in the first WSS hello frame', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    let socket;
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      WebSocket: class extends HandshakeSocket { constructor(url) { super(url); socket = this; } },
      fetch: async () => response({ ok: true, device: { id: 'device-a', name: 'Home PC' }, token: 'x'.repeat(43) }, 201),
    });
    await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    socket.emit('open');
    assert.deepEqual(socket.sent[0], {
      version: 1,
      type: 'device.hello',
      payload: { deviceId: 'device-a', token: 'x'.repeat(43), name: 'Home PC' },
    });
    assert.equal(client.getState().connection, 'connecting');
    socket.emit('message', { data: JSON.stringify({ version: 1, type: 'device.welcome', payload: { deviceId: 'device-a', status: 'online' } }) });
    assert.equal(client.getState().connection, 'online');
    assert.equal(socket.sent[1].type, 'device.capabilities');
    client.stopSession();
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('cloud client executes an approved remote command once and returns the cached result on replay', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    let socket;
    let executions = 0;
    const commandId = '44444444-4444-4444-8444-444444444444';
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      capabilities: { localActions: ['file.search'], protocolVersion: 1 },
      executeRemoteCommand: async (request, options) => {
        executions += 1;
        assert.equal(request.action, 'file.search');
        assert.equal(options.confirmed, false);
        return { ok: true, action: request.action, results: [] };
      },
      WebSocket: class extends HandshakeSocket { constructor(url) { super(url); socket = this; } },
      fetch: async () => response({ ok: true, device: { id: 'device-a', name: 'Home PC' }, token: 'x'.repeat(43) }, 201),
    });
    await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ version: 1, type: 'device.welcome', payload: { deviceId: 'device-a', status: 'online' } }) });
    const frame = JSON.stringify({ version: 1, type: 'command.execute', payload: { commandId, action: 'file.search', args: { query: 'report' }, confirmed: false } });
    socket.emit('message', { data: frame });
    await new Promise((resolve) => setImmediate(resolve));
    socket.emit('message', { data: frame });
    await new Promise((resolve) => setImmediate(resolve));
    const results = socket.sent.filter((message) => message.type === 'command.result');
    assert.equal(executions, 1);
    assert.equal(results.length, 2);
    assert.equal(results[0].payload.result.ok, true);
    client.stopSession();
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('cloud client forwards a validated asynchronous workflow result to the renderer bridge', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    let socket;
    const updates = [];
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      onWorkflowUpdate: (update) => updates.push(update),
      WebSocket: class extends HandshakeSocket { constructor(url) { super(url); socket = this; } },
      fetch: async () => response({ ok: true, device: { id: 'device-a', name: 'Home PC' }, token: 'x'.repeat(43) }, 201),
    });
    await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ version: 1, type: 'device.welcome', payload: { deviceId: 'device-a', status: 'online' } }) });
    socket.emit('message', { data: JSON.stringify({ version: 1, type: 'workflow.update', payload: { workflowId: 'workflow-1', status: 'completed', answer: 'Папка открыта.' } }) });
    assert.deepEqual(updates, [{ workflowId: 'workflow-1', status: 'completed', answer: 'Папка открыта.' }]);
    client.stopSession();
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('cloud client forwards a validated Life OS proposal to the renderer bridge', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    let socket;
    const proposals = [];
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      onLifeProposal: (proposal) => proposals.push(proposal),
      WebSocket: class extends HandshakeSocket { constructor(url) { super(url); socket = this; } },
      fetch: async () => response({ ok: true, device: { id: 'device-a', name: 'Home PC' }, token: 'x'.repeat(43) }, 201),
    });
    await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ version: 1, type: 'device.welcome', payload: { deviceId: 'device-a', status: 'online' } }) });
    socket.emit('message', { data: JSON.stringify({
      version: 1,
      type: 'life.proposal',
      payload: {
        proposalId: 'proposal-1',
        title: 'Вернуться к Life OS',
        explanation: 'Есть открытая договорённость.',
        risk: 'safe',
      },
    }) });
    assert.deepEqual(proposals, [{
      proposalId: 'proposal-1',
      title: 'Вернуться к Life OS',
      explanation: 'Есть открытая договорённость.',
      risk: 'safe',
    }]);
    client.stopSession();
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('cloud client stores a validated Happ artifact outside the repository and removes its secret from the response', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    const secret = 'vless://private-client@example.test:443?security=reality\n';
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      WebSocket: FailingSocket,
      fetch: async (url) => url.endsWith('/v1/desktop/pair')
        ? response({ ok: true, device: { id: 'device-a', name: 'Home PC' }, token: 'x'.repeat(43) }, 201)
        : response({ ok: true, answer: 'VPN-доступ создан.', vpnArtifact: { kind: 'happ-vless', filename: 'Phone-vpn-0123456789ab.txt', content: secret } }),
    });
    await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    const result = await client.sendText('/vpn_confirm 33333333-3333-4333-8333-333333333333');
    assert.equal(result.vpnArtifact.content, undefined);
    assert.equal(result.vpnArtifact.path, path.join(userDataPath, VPN_EXPORT_DIR, 'Phone-vpn-0123456789ab.txt'));
    assert.equal(fs.readFileSync(result.vpnArtifact.path, 'utf8'), secret);
    assert.match(result.answer, /Файл Happ:/);
    client.stopSession();
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
