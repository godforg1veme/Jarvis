const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopRequestRepository } = require('../src/desktop/desktopRequestRepository');
const { DesktopMessageService } = require('../src/desktop/desktopMessageService');
const { registerDesktopRoutes } = require('../src/desktop/desktopRoutes');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config/loadConfig');
const { FixedWindowRateLimiter } = require('../src/http/rateLimiter');
const { registerDesktopPermissionBoundary } = require('../src/userPermissionBoundary');

const device = { id: 'device-a', user_id: 'user-a' };
const commandId = '55555555-5555-4555-8555-555555555555';
function harness(record, allowed = () => true) {
  const calls = [];
  const service = new DesktopMessageService({
    requestRepository: { async getForDevice(scope) { calls.push(scope); return record; } },
    accessService: { async allows(userId, permission) { assert.equal(userId, device.user_id); return allowed(permission); } },
  });
  const app = buildApp({ config: loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' }) });
  const authenticate = async (headers) => {
    if (headers.authorization !== 'Bearer fixture') throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    return device;
  };
  registerDesktopPermissionBoundary(app, {
    authenticate,
    accessService: { async getAccessForUser() { return { blocked: false,
      permissions: ['assistant', 'devices', 'memory', 'documents', 'vpn', 'life'].filter(allowed) }; } },
  });
  registerDesktopRoutes(app, {
    authenticate,
    messageService: service, limiter: new FixedWindowRateLimiter(),
  });
  const read = (id = 'message-a', headers = { authorization: 'Bearer fixture' }) => app.inject({
    method: 'GET', url: `/v1/desktop/requests/${id}`, headers,
  });
  return { app, read, calls };
}

test('request status repository scopes lookup by owner, device and original message ID', async () => {
  let query;
  const repo = new DesktopRequestRepository({ async query(sql, values) { query = { sql, values }; return { rows: [] }; } });
  assert.equal(await repo.getForDevice({ userId: 'u', deviceId: 'd', clientMessageId: 'r' }), null);
  assert.match(query.sql, /WHERE user_id = \$1 AND device_id = \$2 AND client_message_id = \$3/);
  assert.deepEqual(query.values, ['u', 'd', 'r']);
});

test('GET recovered result preserves confirmation but never returns artifacts or internal data', async (t) => {
  const h = harness({ user_id: device.user_id, device_id: device.id, status: 'completed', response: {
    status: 'answered', answer: 'Готово', _recoveryPermissions: ['assistant', 'devices'],
    confirmation: { commandId, private: 'hidden' },
    buttons: [[{ text: 'Подтвердить', data: `cmd:confirm:${commandId}`, private: 'hidden' }]],
    vpnArtifact: { content: 'private artifact' }, storageKey: 'private storage',
    error_code: 'PRIVATE_ERROR', transcription: { private: 'hidden' },
  } });
  t.after(() => h.app.close());
  const response = await h.read();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true, clientMessageId: 'message-a', status: 'completed',
    response: { status: 'answered', answer: 'Готово', confirmation: { commandId },
      buttons: [[{ text: 'Подтвердить', data: `cmd:confirm:${commandId}` }]] },
  });
  assert.deepEqual(h.calls, [{ userId: device.user_id, deviceId: device.id, clientMessageId: 'message-a' }]);
});

for (const status of ['processing', 'failed']) {
  test(`GET ${status} does not disclose partial response or failure diagnostics`, async (t) => {
    const h = harness({ user_id: device.user_id, device_id: device.id, status, response: { answer: 'private partial' } });
    t.after(() => h.app.close());
    assert.deepEqual((await h.read()).json(), { ok: true, clientMessageId: 'message-a', status });
  });
}

for (const foreign of [null, { user_id: 'other', device_id: device.id }, { user_id: device.user_id, device_id: 'other' }]) {
  test(`GET missing or foreign request remains not_found (${JSON.stringify(foreign)})`, async (t) => {
    const h = harness(foreign && { ...foreign, status: 'completed', response: { answer: 'foreign' } });
    t.after(() => h.app.close());
    assert.deepEqual((await h.read()).json(), { ok: true, clientMessageId: 'message-a', status: 'not_found' });
  });
}

test('GET authenticates and validates before querying persistence', async (t) => {
  const h = harness(null);
  t.after(() => h.app.close());
  assert.equal((await h.read('message-a', {})).statusCode, 401);
  assert.equal((await h.read('invalid%20id')).statusCode, 400);
  assert.equal(h.calls.length, 0);
});

test('GET respects revoked assistant and source permissions, including legacy records', async (t) => {
  for (const permissions of [undefined, ['assistant', 'memory']]) {
    const h = harness({ user_id: device.user_id, device_id: device.id, status: 'completed',
      response: { answer: 'private', ...(permissions ? { _recoveryPermissions: permissions } : {}) } },
    (permission) => permission !== 'memory');
    t.after(() => h.app.close());
    assert.equal((await h.read()).statusCode, 403);
  }
  const h = harness(null, () => false);
  t.after(() => h.app.close());
  assert.equal((await h.read()).statusCode, 403);
  assert.equal(h.calls.length, 0);
});

test('assistant-only cached answer remains recoverable without devices permission at the shared boundary', async (t) => {
  const h = harness({ user_id: device.user_id, device_id: device.id, status: 'completed',
    response: { answer: 'Обычный ответ', _recoveryPermissions: ['assistant'] } }, (permission) => permission === 'assistant');
  t.after(() => h.app.close());
  assert.equal((await h.read()).statusCode, 200);
});

test('duplicate POST also refuses cached source data after its permission was revoked', async () => {
  const service = new DesktopMessageService({
    requestRepository: { async claim() { return { created: false, request: { status: 'completed',
      response: { answer: 'device private data', _recoveryPermissions: ['assistant', 'devices'] } } }; } },
    accessService: { async allows(_userId, permission) { return permission === 'assistant'; } },
  });
  await assert.rejects(service.handle({ device, clientMessageId: 'message-a',
    resolveContent: () => { throw new Error('must not execute twice'); } }), { publicCode: 'PERMISSION_DENIED' });
});

test('recovery retains source grants for data reused from conversation history with an empty current search', async () => {
  let documentsAllowed = true;
  let saved;
  const service = new DesktopMessageService({
    accessService: { async allows(_userId, permission) { return permission === 'assistant' || (permission === 'documents' && documentsAllowed); } },
    requestRepository: {
      async claim() { return { created: true }; },
      async complete(input) { saved = input.response; },
      async getForDevice() { return { user_id: device.user_id, device_id: device.id, status: 'completed', response: saved }; },
    },
    conversationRepository: {
      async getOrCreate() { return { id: 'conversation-a' }; },
      async appendMessage() { return { id: 'message-a' }; },
      async recentMessages() { return [{ role: 'assistant', content: 'Earlier document fixture fragment' }]; },
    },
    knowledgeService: { async searchForPrompt() { return []; } },
    assistant: { async answer({ history }) { return history[0].content; } },
  });
  await service.handle({ device, clientMessageId: 'original', resolveContent: async () => ({ content: 'Повтори' }) });
  assert.ok(saved._recoveryPermissions.includes('documents'));
  documentsAllowed = false;
  await assert.rejects(service.getStatus({ device, clientMessageId: 'original' }), { publicCode: 'PERMISSION_DENIED' });
});

test('GET rechecks grants after repository lookup resolves', async (t) => {
  let permitted = true;
  const h = harness(null, () => permitted);
  t.after(() => h.app.close());
  // Use the actual service with a repository that revokes during its await.
  const service = new DesktopMessageService({
    requestRepository: { async getForDevice() { permitted = false; return {
      user_id: device.user_id, device_id: device.id, status: 'completed',
      response: { answer: 'private', _recoveryPermissions: ['assistant'] },
    }; } },
    accessService: { async allows() { return permitted; } },
  });
  await assert.rejects(service.getStatus({ device, clientMessageId: 'message-a' }), { publicCode: 'PERMISSION_DENIED' });
});
