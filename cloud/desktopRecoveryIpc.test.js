const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function handlers(client) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const begin = source.indexOf("  ipcMain.handle('cloud:list-pending-requests'");
  const end = source.indexOf("  ipcMain.handle('cloud:create-command'", begin);
  assert(begin >= 0 && end > begin);
  const registered = new Map();
  vm.runInNewContext(source.slice(begin, end), {
    ipcMain: { handle: (name, fn) => registered.set(name, fn) },
    desktopCloudClient: client, isTrustedMainRenderer: (event) => event.trusted === true,
  });
  return registered;
}

test('recovery IPC rejects foreign frames and invalid IDs before client calls', async () => {
  const calls = [];
  const api = handlers({ listPendingRequests() { calls.push('list'); },
    getRequestStatus() { calls.push('get'); }, acknowledgeRequest() { calls.push('ack'); } });
  for (const fn of api.values()) assert.equal((await fn({ trusted: false }, { clientMessageId: 'valid' })).ok, false);
  for (const name of ['cloud:request-status', 'cloud:acknowledge-request']) {
    assert.equal((await api.get(name)({ trusted: true }, { clientMessageId: '../other' })).ok, false);
  }
  assert.deepEqual(calls, []);
});

test('recovery IPC preserves original ID and sanitizes read or ack failure', async () => {
  const calls = [];
  const api = handlers({
    listPendingRequests() { return [{ clientMessageId: 'original' }]; },
    async getRequestStatus(id) { calls.push(id); return { ok: true, clientMessageId: id, status: 'processing' }; },
    acknowledgeRequest() { throw new Error('private filesystem detail'); },
  });
  const list = await api.get('cloud:list-pending-requests')({ trusted: true });
  assert.equal(list.requests[0].clientMessageId, 'original');
  const result = await api.get('cloud:request-status')({ trusted: true }, { clientMessageId: 'original' });
  assert.equal(result.clientMessageId, 'original');
  assert.deepEqual(calls, ['original']);
  const ack = await api.get('cloud:acknowledge-request')({ trusted: true }, { clientMessageId: 'original' });
  assert.equal(ack.ok, false);
  assert.equal(JSON.stringify(ack).includes('private'), false);
});

test('send IPC distinguishes a blocked send from an unknown server outcome', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const begin = source.indexOf("  ipcMain.handle('cloud:send-message'");
  const end = source.indexOf("  ipcMain.handle('cloud:list-pending-requests'", begin);
  for (const unknown of [false, true]) {
    let send;
    vm.runInNewContext(source.slice(begin, end), {
      ipcMain: { handle: (_name, handler) => { send = handler; } },
      desktopCloudClient: { async sendText() { throw Object.assign(new Error('private diagnostic'),
        unknown ? { outcome: 'unknown', clientMessageId: 'original' } : {}); } },
      isTrustedMainRenderer: () => true, broadcastCoreMode() {},
    });
    const result = await send({}, { text: 'hello' });
    assert.equal(result.outcome, unknown ? 'unknown' : 'not_sent');
    assert.equal(result.clientMessageId, unknown ? 'original' : undefined);
    assert.equal(result.error.includes('private'), false);
  }
});
