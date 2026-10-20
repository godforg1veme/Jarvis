const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_CLOUD_SERVER_URL, DesktopCloudClient, VPN_EXPORT_DIR, normalizeServerUrl, toWebSocketUrl } = require('./desktopCloudClient');

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('HTTP success retains its ID through restart until display acknowledgement', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-delivery-'));
  try {
    fs.writeFileSync(path.join(directory, 'cloud-device.json'), JSON.stringify({
      serverUrl: 'https://example.test', deviceId: 'device-a', deviceName: 'Test',
    }));
    fs.writeFileSync(path.join(directory, 'cloud-device.token'), fakeSafeStorage().encryptString('fixture'));
    const options = { userDataPath: directory, safeStorage: fakeSafeStorage(),
      fetch: async () => response({ ok: true, answer: 'Done' }), WebSocket: FailingSocket };
    const result = await new DesktopCloudClient(options).sendText('test', 'legacy-message:1');
    const restarted = new DesktopCloudClient(options);
    assert.equal(restarted.listPendingRequests()[0].clientMessageId, result.clientMessageId);
    restarted.acknowledgeRequest(result.clientMessageId);
    assert.deepEqual(restarted.listPendingRequests(), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('visual memory keeps its existing image budget while ordinary JSON remains bounded', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-image-budget-'));
  try {
    const data = 'a'.repeat(3 * 1024 * 1024);
    const client = new DesktopCloudClient({ userDataPath: directory, safeStorage: fakeSafeStorage(),
      fetch: async () => response({ ok: true, image: { contentType: 'image/png', data } }), WebSocket: FailingSocket });
    client._readToken = () => 'fixture';
    client.publicState = { serverUrl: 'https://example.test', deviceId: 'fixture' };
    await assert.rejects(client._request('/v1/desktop/device'), /HTTP_RESPONSE_TOO_LARGE/);
    assert.equal((await client.getVisionMemory('memory-fixture')).image.data.length, data.length);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('pairing uses the bounded transport without persisting incomplete credentials', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-pair-budget-'));
  try {
    const slow = new DesktopCloudClient({ userDataPath: directory, safeStorage: fakeSafeStorage(),
      fetch: () => new Promise(() => {}), WebSocket: FailingSocket, httpTimeoutMs: 10 });
    await assert.rejects(slow.pair({ serverUrl: 'https://example.test', pairingCode: 'fixture-code' }), /HTTP_DEADLINE_EXCEEDED/);
    const oversized = new DesktopCloudClient({ userDataPath: directory, safeStorage: fakeSafeStorage(),
      fetch: async () => response({ ok: true, extra: 'x'.repeat(100) }), WebSocket: FailingSocket, httpMaxBytes: 20 });
    await assert.rejects(oversized.pair({ serverUrl: 'https://example.test', pairingCode: 'fixture-code' }), /HTTP_RESPONSE_TOO_LARGE/);
    assert.equal(fs.existsSync(path.join(directory, 'cloud-device.token')), false);
    assert.equal(fs.existsSync(path.join(directory, 'cloud-device.json')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('unknown send survives restart and status lookup never repeats POST', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-recovery-'));
  const id = '12345678-1234-4234-8234-123456789abc';
  let posts = 0;
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/v1/desktop/messages')) { posts += 1; throw new Error('network failed'); }
    assert.equal(options.method, undefined);
    return response({ ok: true, clientMessageId: id, status: 'completed', response: { ok: true, answer: 'Recovered' } });
  };
  try {
    const state = { serverUrl: 'https://example.test', deviceId: 'device-a', deviceName: 'Test' };
    fs.writeFileSync(path.join(directory, 'cloud-device.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(directory, 'cloud-device.token'), fakeSafeStorage().encryptString('token'));
    const client = new DesktopCloudClient({ userDataPath: directory, safeStorage: fakeSafeStorage(), fetch, WebSocket: FailingSocket });
    await assert.rejects(client.sendText('private text', id), (error) => error.outcome === 'unknown' && error.clientMessageId === id);
    assert.equal(posts, 1);
    const raw = fs.readFileSync(path.join(directory, 'cloud-outbound-requests.json'), 'utf8');
    assert.equal(raw.includes('private text'), false);
    const restarted = new DesktopCloudClient({ userDataPath: directory, safeStorage: fakeSafeStorage(), fetch, WebSocket: FailingSocket });
    assert.equal(restarted.listPendingRequests().length, 1);
    assert.equal((await restarted.getRequestStatus(id)).status, 'completed');
    assert.equal(restarted.listPendingRequests().length, 1);
    assert.equal(posts, 1);
    restarted.acknowledgeRequest(id);
    assert.deepEqual(restarted.listPendingRequests(), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('failed outbound journal write blocks POST', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-recovery-'));
  let posts = 0;
  try {
    fs.writeFileSync(path.join(directory, 'cloud-device.json'), JSON.stringify({
      serverUrl: 'https://example.test', deviceId: 'device-a', deviceName: 'Test',
    }));
    fs.writeFileSync(path.join(directory, 'cloud-device.token'), fakeSafeStorage().encryptString('token'));
    const client = new DesktopCloudClient({ userDataPath: directory, safeStorage: fakeSafeStorage(),
      fetch: async () => { posts += 1; return response({ ok: true }); }, WebSocket: FailingSocket });
    const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('disk failed'); });
    await assert.rejects(client.sendText('private text'), /OUTBOUND_STORE_UNAVAILABLE/);
    rename.mock.restore();
    assert.equal(posts, 0);
    await assert.rejects(client.sendText('private text'), /OUTBOUND_STORE_UNAVAILABLE/);
    assert.equal(posts, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

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

function journalClient(userDataPath, executeRemoteCommand = async () => ({ ok: true })) {
  const client = new DesktopCloudClient({
    userDataPath, safeStorage: fakeSafeStorage(), WebSocket: FailingSocket,
    capabilities: { localActions: ['file.write'] }, executeRemoteCommand,
  });
  const results = [];
  client._sendSessionMessage = (type, payload) => results.push({ type, ...payload });
  return { client, results, execute: (commandId = 'cmd-journal-test') => client._handleRemoteCommand({
    payload: { commandId, action: 'file.write', args: {}, confirmed: true },
  }) };
}

test('corrupt and invalid command journals block changing execution without replacing the file', async () => {
  for (const content of ['{broken', '[]', 'null', '{"bad-id":{"status":"running"}}',
    '{"cmd-old":{"status":"completed"}}', '{"cmd-old":{"status":"other"}}']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
    const journalPath = path.join(directory, 'cloud-command-journal.json');
    try {
      fs.writeFileSync(journalPath, content);
      let executions = 0;
      const { client, results, execute } = journalClient(directory, async () => { executions += 1; return { ok: true }; });
      await execute();
      await execute();
      assert.equal(executions, 0, content);
      assert.equal(fs.readFileSync(journalPath, 'utf8'), content);
      assert.equal(client.getState().commandJournalStatus, 'blocked');
      assert.equal(results[0].result.code, 'COMMAND_JOURNAL_CORRUPT');
      assert.equal(JSON.stringify(results).includes(content), false);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('journal permission read errors fail closed and expose only a safe code', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
  const journalPath = path.join(directory, 'cloud-command-journal.json');
  try {
    fs.writeFileSync(journalPath, '{}');
    const originalRead = fs.readFileSync;
    const readMock = t.mock.method(fs, 'readFileSync', function (filename, ...args) {
      if (filename === journalPath) throw Object.assign(new Error('private-read-error'), { code: 'EACCES' });
      return originalRead.call(this, filename, ...args);
    });
    let executions = 0;
    const { client, results, execute } = journalClient(directory, async () => { executions += 1; return { ok: true }; });
    readMock.mock.restore();
    await execute();
    assert.equal(executions, 0);
    assert.equal(client.getState().commandJournalError, 'COMMAND_JOURNAL_UNAVAILABLE');
    assert.equal(results[0].result.code, 'COMMAND_JOURNAL_UNAVAILABLE');
    assert.equal(JSON.stringify(results).includes('private-read-error'), false);
    assert.equal(fs.readFileSync(journalPath, 'utf8'), '{}');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('first-run journal persists a checksummed version and replays the original result after restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
  try {
    let executions = 0;
    const executor = async () => { executions += 1; return { ok: true, value: 42 }; };
    const first = journalClient(directory, executor);
    await first.execute();
    const disk = JSON.parse(fs.readFileSync(path.join(directory, 'cloud-command-journal.json'), 'utf8'));
    assert.equal(disk.version, 1);
    assert.match(disk.checksum, /^[a-f0-9]{64}$/);
    assert.equal(disk.entries['cmd-journal-test'].status, 'completed');
    const restarted = journalClient(directory, executor);
    await restarted.execute();
    assert.equal(executions, 1);
    assert.deepEqual(restarted.results[0].result, first.results[0].result);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('checksum mismatch and unsupported journal versions block execution and preserve evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
  const journalPath = path.join(directory, 'cloud-command-journal.json');
  try {
    await journalClient(directory).execute();
    const valid = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    for (const invalid of [{ ...valid, checksum: '0'.repeat(64) }, { ...valid, version: 2 }]) {
      const content = JSON.stringify(invalid);
      fs.writeFileSync(journalPath, content);
      let executions = 0;
      const harness = journalClient(directory, async () => { executions += 1; return { ok: true }; });
      await harness.execute('cmd-new');
      assert.equal(executions, 0);
      assert.equal(harness.results[0].result.code, 'COMMAND_JOURNAL_CORRUPT');
      assert.equal(fs.readFileSync(journalPath, 'utf8'), content);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('legacy journals retain running, unknown and old completed ID claims beyond the result cache limit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
  const journalPath = path.join(directory, 'cloud-command-journal.json');
  try {
    const entries = Object.fromEntries(Array.from({ length: 110 }, (_, index) => [
      `cmd-running-${index}`, { status: 'running', action: 'file.write' },
    ]));
    entries['cmd-uncertain'] = { status: 'completed', result: { ok: false, executionUnknown: true } };
    for (let index = 0; index < 105; index += 1) {
      entries[`cmd-complete-${index}`] = { status: 'completed', result: { ok: true, value: index } };
    }
    fs.writeFileSync(journalPath, JSON.stringify(entries));
    let executions = 0;
    const executor = async () => { executions += 1; return { ok: true }; };
    const harness = journalClient(directory, executor);
    assert.equal(harness.client.getState().commandJournalStatus, 'ready');
    await harness.execute('cmd-new');
    const migrated = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    assert.equal(migrated.version, 1);
    assert.equal(Object.keys(migrated.entries).length, Object.keys(entries).length + 1);
    assert.equal(migrated.entries['cmd-running-0'].status, 'running');
    assert.equal(migrated.entries['cmd-uncertain'].result.executionUnknown, true);
    assert.equal(migrated.entries['cmd-complete-0'].status, 'unknown');
    assert.equal(Object.values(migrated.entries).filter((entry) => entry.status === 'completed'
      && entry.result.executionUnknown !== true).length, 100);
    const restarted = journalClient(directory, executor);
    for (const id of ['cmd-running-0', 'cmd-running-109', 'cmd-uncertain', 'cmd-complete-0', 'cmd-complete-104']) {
      await restarted.execute(id);
    }
    assert.equal(executions, 1);
    assert.equal(restarted.results[0].result.executionUnknown, true);
    assert.equal(restarted.results[2].result.executionUnknown, true);
    assert.equal(restarted.results[3].result.executionUnknown, true);
    assert.deepEqual(restarted.results[4].result, { ok: true, value: 104 });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('removal or replacement of an existing journal blocks new commands without recreating it', async () => {
  for (const replacement of [null, '{changed']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
    const journalPath = path.join(directory, 'cloud-command-journal.json');
    try {
      let executions = 0;
      const harness = journalClient(directory, async () => { executions += 1; return { ok: true }; });
      await harness.execute('cmd-first');
      if (replacement === null) fs.unlinkSync(journalPath);
      else fs.writeFileSync(journalPath, replacement);
      await harness.execute('cmd-next');
      await harness.execute('cmd-next');
      assert.equal(executions, 1);
      assert.equal(harness.client.getState().commandJournalStatus, 'blocked');
      assert.equal(harness.results[1].result.code, 'COMMAND_JOURNAL_UNAVAILABLE');
      if (replacement === null) assert.equal(fs.existsSync(journalPath), false);
      else assert.equal(fs.readFileSync(journalPath, 'utf8'), replacement);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('journal write and rename failures remain blocked after filesystem access recovers', async (t) => {
  for (const method of ['writeFileSync', 'renameSync']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
    const journalPath = path.join(directory, 'cloud-command-journal.json');
    try {
      fs.writeFileSync(journalPath, '{}');
      let executions = 0;
      const harness = journalClient(directory, async () => { executions += 1; return { ok: true }; });
      const original = fs[method];
      const failure = t.mock.method(fs, method, function (filename, ...args) {
        if (String(filename).startsWith(journalPath)) throw Object.assign(new Error('private-write-error'), { code: 'EACCES' });
        return original.call(this, filename, ...args);
      });
      await harness.execute();
      failure.mock.restore();
      await harness.execute();
      await harness.execute('cmd-next');
      assert.equal(executions, 0);
      assert.equal(harness.client.getState().commandJournalStatus, 'blocked');
      assert.equal(JSON.stringify(harness.results).includes('private-write-error'), false);
      assert.equal(fs.readFileSync(journalPath, 'utf8'), '{}');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('failure to persist completion retains the running claim and reports unknown on restart', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
  const journalPath = path.join(directory, 'cloud-command-journal.json');
  let failure;
  try {
    let executions = 0;
    const executor = async () => {
      executions += 1;
      const originalRename = fs.renameSync;
      failure = t.mock.method(fs, 'renameSync', function (filename, ...args) {
        if (String(filename).startsWith(journalPath)) throw new Error('private-rename-error');
        return originalRename.call(this, filename, ...args);
      });
      return { ok: true };
    };
    const harness = journalClient(directory, executor);
    await harness.execute();
    failure.mock.restore();
    assert.equal(harness.results[0].result.executionUnknown, true);
    assert.equal(harness.client.commandJournal['cmd-journal-test'].status, 'running');
    await harness.execute('cmd-next');
    const restarted = journalClient(directory, executor);
    await restarted.execute();
    assert.equal(executions, 1);
    assert.equal(restarted.results[0].result.executionUnknown, true);
    assert.equal(JSON.stringify(harness.results).includes('private-rename-error'), false);
  } finally {
    if (failure) failure.mock.restore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

test('cloud client exposes closed Life OS v2 routes without owner or action arguments', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    const requests = [];
    const client = new DesktopCloudClient({
      userDataPath, safeStorage: fakeSafeStorage(), WebSocket: FailingSocket,
      fetch: async (url, options = {}) => {
        requests.push({ url, options });
        if (url.endsWith('/v1/desktop/pair')) return response({ ok: true, device: { id: 'device-a', name: 'Home PC' }, token: 'x'.repeat(43) }, 201);
        return response({ ok: true });
      },
    });
    await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    await client.setLifeMode({ mode: 'focus', revision: 1 });
    await client.getLifePreferences();
    await client.getLifePeople(false);
    await client.createLifeRecoveryPlan('11111111-1111-4111-8111-111111111111', 2);
    await client.syncLifeSource('22222222-2222-4222-8222-222222222222');
    const life = requests.slice(1);
    assert.deepEqual(life.map((item) => new URL(item.url).pathname), [
      '/v1/desktop/life/mode', '/v1/desktop/life/preferences', '/v1/desktop/life/people',
      '/v1/desktop/life/projects/11111111-1111-4111-8111-111111111111/recovery-plans',
      '/v1/desktop/life/sources/22222222-2222-4222-8222-222222222222/sync',
    ]);
    assert.equal(life.every((item) => !String(item.options.body || '').includes('owner')), true);
    assert.equal(life.every((item) => !String(item.options.body || '').includes('actionArguments')), true);
    client.stopSession();
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

test('cloud client forwards a validated Life OS reminder without executing a local action', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cloud-client-'));
  try {
    let socket;
    const reminders = [];
    const client = new DesktopCloudClient({
      userDataPath,
      safeStorage: fakeSafeStorage(),
      onLifeReminder: (reminder) => reminders.push(reminder),
      executeTool: async () => { throw new Error('reminder must not execute a tool'); },
      WebSocket: class extends HandshakeSocket { constructor(url) { super(url); socket = this; } },
      fetch: async () => response({ ok: true, device: { id: 'device-a', name: 'Home PC' }, token: 'x'.repeat(43) }, 201),
    });
    await client.pair({ serverUrl: 'https://jarvis.example.test', pairingCode: 'JARVIS-ABCD-1234-ABCD-1234' });
    socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ version: 1, type: 'device.welcome', payload: { deviceId: 'device-a', status: 'online' } }) });
    socket.emit('message', { data: JSON.stringify({
      version: 1, type: 'life.reminder', payload: { reminderId: 'reminder-1', title: 'Продолжить Life OS' },
    }) });
    assert.deepEqual(reminders, [{ reminderId: 'reminder-1', title: 'Продолжить Life OS' }]);
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
