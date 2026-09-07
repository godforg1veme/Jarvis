const assert = require('node:assert/strict');
const test = require('node:test');
const { parseApprovalCallback } = require('../src/operations/sessions/telegramApproval');
const { credentialHash, createCredential } = require('../src/operations/sessions/sessionCredentials');
const { SessionService } = require('../src/operations/sessions/sessionService');
const { requireOperationsHost } = require('../src/operations/auth/requirePanelSession');

test('panel credentials are random opaque values and only hashes are persisted', () => {
  const credential = createCredential();
  assert.match(credential, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(credentialHash(credential).length, 32);
  assert.throws(() => credentialHash('invalid'), /invalid/);
});

test('approval callbacks have a compact closed format', () => {
  assert.deepEqual(parseApprovalCallback('ops:allow:2d2f9f55-6859-49d9-b54d-9d42d4251d52'), { approved: true, id: '2d2f9f55-6859-49d9-b54d-9d42d4251d52' });
  assert.equal(parseApprovalCallback('ops:allow:../../etc/passwd'), null);
});

test('session service lists current browser and revokes the selected session', async () => {
  const revoked = [];
  const service = new SessionService({ repository: {
    async listActiveSessions() { return [{ id: 'session-a' }, { id: 'session-b' }]; },
    async revokeSession(id, reason) { revoked.push({ id, reason }); return { id }; },
  } });
  const sessions = await service.listSessions('session-a');
  assert.deepEqual(sessions.map((session) => session.current), [true, false]);
  assert.deepEqual(await service.revokeSession({ sessionId: 'session-b', currentSessionId: 'session-a' }), { revoked: true, current: false });
  assert.deepEqual(revoked, [{ id: 'session-b', reason: 'owner_forget' }]);
});

test('operations hostname middleware hides every ops route on another host', async () => {
  const middleware = requireOperationsHost('https://ops.example.test');
  let response = null;
  await middleware({ raw: { url: '/ops/api/overview' }, headers: { host: 'example.test' } }, {
    code(status) { response = { status }; return this; },
    send(body) { response.body = body; return this; },
  });
  assert.deepEqual(response, { status: 404, body: { ok: false, code: 'OPERATIONS_HOST_REQUIRED' } });
});
