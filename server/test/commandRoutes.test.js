const assert = require('node:assert/strict');
const test = require('node:test');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config/loadConfig');
const { registerCommandRoutes } = require('../src/commands/commandRoutes');

const device = {
  id: '22222222-2222-4222-8222-222222222222',
  user_id: '11111111-1111-4111-8111-111111111111',
};

function createHarness() {
  const calls = [];
  const app = buildApp({ config: loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' }) });
  registerCommandRoutes(app, {
    authenticate: async (headers) => {
      if (headers.authorization !== 'Bearer valid') {
        const error = new Error('auth');
        error.statusCode = 401;
        error.publicCode = 'DEVICE_AUTH_REQUIRED';
        throw error;
      }
      return device;
    },
    commandService: {
      async create(input) {
        calls.push(['create', input]);
        return { status: 'awaiting_confirmation', command: { id: '33333333-3333-4333-8333-333333333333' }, prompt: 'confirm' };
      },
      async get(input) { calls.push(['get', input]); return { id: input.commandId, user_id: device.user_id, device_id: device.id, status: 'running', action: 'file.search', policy: 'observe' }; },
      async approve(input) { calls.push(['approve', input]); return { status: 'running', command: { id: input.commandId, status: 'running', action: 'file.search', policy: 'observe' } }; },
      async reject(input) { calls.push(['reject', input]); return { status: 'cancelled', command: { id: input.commandId, status: 'cancelled', action: 'file.delete', policy: 'requires_confirmation' } }; },
    },
  });
  return { app, calls };
}

test('desktop command routes authenticate and preserve the source device', async () => {
  const { app, calls } = createHarness();
  const denied = await app.inject({ method: 'POST', url: '/v1/desktop/commands', payload: { action: 'file.search', args: { query: 'report' } } });
  assert.equal(denied.statusCode, 401);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/desktop/commands',
    headers: { authorization: 'Bearer valid' },
    payload: { deviceId: device.id, action: 'file.delete', args: { path: 'C:\\Temp\\old.txt' } },
  });
  assert.equal(response.statusCode, 202);
  assert.equal(calls[0][1].userId, device.user_id);
  assert.equal(calls[0][1].originDeviceId, device.id);
  assert.equal(response.json().prompt, 'confirm');
  await app.close();
});

test('desktop confirmation endpoints are scoped to the authenticated source device', async () => {
  const { app, calls } = createHarness();
  const commandId = '33333333-3333-4333-8333-333333333333';
  const approved = await app.inject({ method: 'POST', url: `/v1/desktop/commands/${commandId}/approve`, headers: { authorization: 'Bearer valid' } });
  assert.equal(approved.statusCode, 200);
  assert.equal(calls[0][1].originDeviceId, device.id);
  const rejected = await app.inject({ method: 'POST', url: `/v1/desktop/commands/${commandId}/reject`, headers: { authorization: 'Bearer valid' } });
  assert.equal(rejected.statusCode, 200);
  assert.equal(calls[1][1].originDeviceId, device.id);
  await app.close();
});
