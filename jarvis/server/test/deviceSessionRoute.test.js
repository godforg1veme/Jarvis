const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const test = require('node:test');
const { createDeviceSessionHandler } = require('../src/devices/deviceSessionRoute');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
    this.closed = null;
  }

  send(value) { this.sent.push(JSON.parse(value)); }
  close(code, reason) { this.closed = { code, reason }; this.emit('close'); }
}

function hello(token = 'x'.repeat(43)) {
  return JSON.stringify({
    version: 1,
    type: 'device.hello',
    payload: { deviceId: 'device-a', token, name: 'Home PC' },
  });
}

test('device session authenticates from the first TLS WebSocket message and never logs its token', async () => {
  const socket = new FakeSocket();
  const events = [];
  const handler = createDeviceSessionHandler({
    authenticate: async (headers) => {
      assert.equal(headers.authorization, `Bearer ${'x'.repeat(43)}`);
      return { id: 'device-a', user_id: 'user-a' };
    },
    repository: {
      async markOnline(value) { events.push(['online', value]); return { id: 'device-a', user_id: 'user-a' }; },
      async markOffline(value) { events.push(['offline', value]); },
      async setCapabilities(value) { events.push(['capabilities', value]); },
    },
    logger: { warn(value) { events.push(['warn', value]); } },
  });

  await handler(socket);
  socket.emit('message', hello());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(socket.closed, null);
  assert.deepEqual(socket.sent[0], { version: 1, type: 'device.welcome', payload: { deviceId: 'device-a', status: 'online' } });
  assert.deepEqual(events[0], ['online', { userId: 'user-a', deviceId: 'device-a' }]);
  socket.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.at(-1), ['offline', { userId: 'user-a', deviceId: 'device-a' }]);
});

test('device session rejects a non-hello frame before authentication', async () => {
  const socket = new FakeSocket();
  const handler = createDeviceSessionHandler({
    authenticate: async () => { throw new Error('must not authenticate'); },
    repository: {},
  });
  await handler(socket);
  socket.emit('message', JSON.stringify({ version: 1, type: 'device.heartbeat', payload: {} }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(socket.closed, { code: 1008, reason: 'authentication failed' });
});

test('device session forwards validated command results only for the authenticated device', async () => {
  const socket = new FakeSocket();
  const results = [];
  const handler = createDeviceSessionHandler({
    authenticate: async () => ({ id: 'device-a', user_id: 'user-a' }),
    repository: {
      async markOnline() { return { id: 'device-a', user_id: 'user-a' }; },
      async markOffline() {},
      async setCapabilities() {},
    },
    commandService: {
      async handleResult(input) { results.push(input); },
    },
  });
  await handler(socket);
  socket.emit('message', hello());
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('message', JSON.stringify({
    version: 1,
    type: 'command.result',
    payload: { commandId: 'command-a', result: { ok: true, action: 'file.search', results: [] } },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(results.length, 1);
  assert.equal(results[0].device.id, 'device-a');
  assert.equal(results[0].commandId, 'command-a');
});
