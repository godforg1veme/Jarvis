const assert = require('node:assert/strict');
const test = require('node:test');
const EventEmitter = require('node:events');
const Fastify = require('fastify');
const { desktopPermission, registerDesktopPermissionBoundary } = require('../src/userPermissionBoundary');
const { DeviceService } = require('../src/devices/deviceService');
const { createDeviceSessionHandler } = require('../src/devices/deviceSessionRoute');

test('canonical router paths enforce permissions despite escaped static segments', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let permissions = [];
  registerDesktopPermissionBoundary(app, {
    accessService: { async getAccessForUser() { return { blocked: false, permissions }; } },
    authenticate: async () => ({ user_id: 'user-a' }),
  });
  for (const path of ['/v1/desktop/life/bootstrap', '/v1/vision/memories', '/v1/desktop/voice/transcribe']) {
    app.get(path, async () => ({ ok: true }));
  }
  app.get('/v1/desktop/session', async () => ({ handshake: true }));
  for (const url of ['/v1/deskt%6fp/life/bootstrap', '/v1/desktop/%6cife/bootstrap', '/v1/visi%6fn/memories']) {
    assert.equal((await app.inject({ url })).statusCode, 403, url);
  }
  permissions = ['devices'];
  assert.equal((await app.inject({ url: '/v1/desktop/voice/transcribe' })).statusCode, 403);
  assert.equal((await app.inject({ url: '/v1/vision/memories' })).statusCode, 403);
  permissions = ['memory'];
  assert.equal((await app.inject({ url: '/v1/vision/memories' })).statusCode, 403);
  permissions = ['memory', 'devices'];
  assert.equal((await app.inject({ url: '/v1/vision/memories' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/desktop/session' })).statusCode, 200);
  assert.equal(desktopPermission({ url: '/v1/desktop/session' }), null);
});

test('an old pairing code is consumed and its device revoked when rights were withdrawn', async () => {
  const events = [];
  const service = new DeviceService({
    repository: {
      async claimPairingCode() { return { id: 'device-a', user_id: 'user-a', token: 'private' }; },
      async revokeForUser(value) { events.push(value); },
    },
    accessService: { async allows() { return false; } },
  });
  await assert.rejects(service.claimPairing({ code: 'old-code' }), { publicCode: 'PERMISSION_DENIED' });
  assert.deepEqual(events, [{ userId: 'user-a', deviceId: 'device-a' }]);
  await assert.rejects(service.beginPairing({ userId: 'user-a', deviceName: 'PC' }), { publicCode: 'PERMISSION_DENIED' });
});

class Socket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; this.closed = false; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; this.emit('close'); }
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const frame = (type, payload) => JSON.stringify({ version: 1, type, payload });
const hello = () => frame('device.hello', { deviceId: 'device-a', token: 'x'.repeat(43), name: 'PC' });

test('WebSocket hello rejects blocked users and keeps revoked original-result reconciliation', async () => {
  let allowed = false;
  let online = 0, capabilityWrites = 0;
  const results = [];
  const handler = createDeviceSessionHandler({
    authenticate: async () => ({ id: 'device-a', user_id: 'user-a' }),
    accessService: { async allows() { return allowed; } },
    repository: {
      async markOnline() { online++; return { id: 'device-a', user_id: 'user-a' }; },
      async markOffline() {},
      async setCapabilities() { capabilityWrites++; },
    },
    commandService: { async handleResult(value) { results.push(value); } },
  });
  const blocked = new Socket();
  await handler(blocked);
  blocked.emit('message', hello()); await settle();
  assert.equal(blocked.closed, true);
  assert.equal(online, 0);

  allowed = true;
  const socket = new Socket();
  await handler(socket);
  socket.emit('message', hello()); await settle();
  assert.equal(socket.sent[0].type, 'device.welcome');
  allowed = false;
  socket.emit('message', frame('device.heartbeat', {})); await settle();
  assert.equal(online, 1);
  assert.equal(socket.closed, false);
  socket.emit('message', frame('device.capabilities', { actions: ['file.search'] })); await settle();
  assert.equal(capabilityWrites, 0);
  socket.emit('message', frame('command.result', {
    commandId: 'command-a', result: { ok: true, action: 'file.search', results: [] },
  })); await settle();
  assert.equal(results.length, 1);
  assert.equal(results[0].commandId, 'command-a');
  socket.close(); await settle();
});
