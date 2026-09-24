const assert = require('node:assert/strict');
const test = require('node:test');
const { ConnectionAdminService } = require('../src/operations/connections/connectionAdminService');

test('device reassignment returns a new pairing code but persists only its hash', async () => {
  let stored;
  const service = new ConnectionAdminService({ async beginDeviceReassignment(input) { stored = input; return { id: 'reassignment-1', deviceName: 'Домашний ПК', expiresAt: input.expiresAt }; } });
  const result = await service.reassignDevice({ deviceId: 'device-1', targetUserId: 'user-2', panelSessionId: 'session-1' });
  assert.match(result.code, /^JARVIS-(?:[A-F0-9]{4}-){3}[A-F0-9]{4}$/);
  assert.equal(stored.code, undefined); assert.equal(stored.codeHash.length, 32);
});

test('device reassignment closes its live session only after database revocation succeeds', async () => {
  const calls = [];
  const service = new ConnectionAdminService({ async beginDeviceReassignment() { calls.push('committed'); return { id: 'move' }; } }, { onDeviceRevoked(id) { calls.push(id); } });
  await service.reassignDevice({ deviceId: 'old-device' });
  assert.deepEqual(calls, ['committed', 'old-device']);
});

test('Telegram reassignment delegates only identity metadata', async () => {
  const input = { identityId: 'identity-1', targetUserId: 'user-2', panelSessionId: 'session-1' };
  const service = new ConnectionAdminService({ async reassignTelegram(value) { assert.deepEqual(value, input); return { id: value.identityId }; } });
  assert.deepEqual(await service.reassignTelegram(input), { id: 'identity-1' });
});
