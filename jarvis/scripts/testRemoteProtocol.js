const assert = require('assert');
const {
  PROTOCOL_VERSION,
  createRemoteMessage,
  validateRemoteMessage,
} = require('../agents/remoteProtocol');

const hello = createRemoteMessage('device.hello', {
  deviceId: 'device-home-pc',
  token: 'test-token-not-a-secret',
  name: 'Home PC',
}, { id: 'hello-1' });
assert.strictEqual(hello.version, PROTOCOL_VERSION);
assert.strictEqual(hello.payload.deviceId, 'device-home-pc');

const command = createRemoteMessage('command.execute', {
  commandId: 'command-1',
  action: 'file.search',
  args: { query: 'report', location: 'computer' },
  confirmed: false,
});
assert.strictEqual(command.payload.action, 'file.search');
assert.strictEqual(command.payload.confirmed, false);

assert.throws(() => validateRemoteMessage({ version: 2, type: 'device.heartbeat', payload: {} }), /unsupported/);
assert.throws(() => createRemoteMessage('device.hello', { deviceId: 'x', token: '' }), /token is required/);
assert.throws(() => createRemoteMessage('command.execute', {
  commandId: 'command-2',
  action: 'file.copy',
  args: { from: 'a' },
}), /destination is required/);
assert.throws(() => createRemoteMessage('command.execute', {
  commandId: 'command-3',
  action: 'process.shell',
  args: {},
}), /unknown tool action/);

console.log('[testRemoteProtocol] remote protocol tests passed');
