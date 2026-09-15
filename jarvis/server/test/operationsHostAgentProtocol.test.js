const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_ENVELOPE_BYTES,
  PROTOCOL_VERSION,
  validateRequest,
  validateResponse,
} = require('../src/operations/hostAgentProtocol');

const REQUEST_ID = '2d2f9f55-6859-49d9-b54d-9d42d4251d52';
const NOW = '2026-09-04T10:00:00.000Z';

function request(overrides = {}) {
  return {
    version: PROTOCOL_VERSION,
    requestId: REQUEST_ID,
    operation: 'service.logs.read',
    arguments: { serviceId: 'jarvis-server', maxLines: 20 },
    sentAt: NOW,
    ...overrides,
  };
}

test('Host Agent protocol accepts only declared operations and closed arguments', () => {
  assert.deepEqual(validateRequest(request()), request());
  assert.deepEqual(validateRequest(request({ operation: 'host.snapshot', arguments: {} })), {
    version: 1,
    requestId: REQUEST_ID,
    operation: 'host.snapshot',
    arguments: {},
    sentAt: NOW,
  });
  assert.throws(() => validateRequest(request({ operation: 'shell.exec' })), /invalid/);
  assert.throws(() => validateRequest(request({ arguments: { serviceId: 'jarvis-server', command: 'id' } })), /invalid/);
  assert.throws(() => validateRequest(request({ arguments: { serviceId: 'jarvis-server', maxLines: 501 } })), /invalid/);
});

test('Host Agent protocol validates VPN operations without accepting config or secrets', () => {
  const issue = validateRequest({ version: 1, requestId: REQUEST_ID, operation: 'vpn.client.issue', arguments: { label: 'My Phone' }, sentAt: NOW });
  assert.deepEqual(issue.arguments, { label: 'My Phone' });
  assert.throws(() => validateRequest({ ...issue, arguments: { label: 'Phone', config: {} } }), /invalid/i);
  assert.throws(() => validateRequest({ ...issue, operation: 'vpn.client.revoke', arguments: { clientId: '../../root' } }), /invalid/i);
  const hysteria = validateRequest({ ...issue, operation: 'vpn.hysteria2.client.issue', arguments: { label: 'My iPhone' } });
  assert.deepEqual(hysteria.arguments, { label: 'My iPhone' });
  assert.throws(() => validateRequest({ ...hysteria, operation: 'vpn.hysteria2.restart', arguments: { port: 53 } }), /invalid/i);
  const health = validateRequest({ version: 1, requestId: REQUEST_ID, operation: 'vpn.health.snapshot', arguments: {}, sentAt: NOW });
  assert.deepEqual(health.arguments, {});
  assert.throws(() => validateRequest({ ...health, arguments: { extra: true } }), /invalid/i);
});

test('Host Agent protocol rejects malformed, oversized, and mismatched envelopes', () => {
  assert.throws(() => validateRequest(request({ requestId: 'not-a-uuid' })), /invalid/);
  assert.throws(() => validateRequest({ ...request(), extra: true }), /invalid/);
  assert.throws(() => validateRequest({ ...request(), arguments: { serviceId: 'jarvis-server', padding: 'x'.repeat(MAX_ENVELOPE_BYTES) } }), /large|invalid/);

  const accepted = validateRequest(request());
  const response = {
    version: 1,
    requestId: REQUEST_ID,
    operation: 'service.logs.read',
    receivedAt: NOW,
    completedAt: NOW,
    result: { state: 'succeeded', data: {} },
  };
  assert.deepEqual(validateResponse(response, accepted), response);
  assert.throws(() => validateResponse({ ...response, requestId: '14b853b1-bc80-4d47-b469-c1c2649c0a94' }, accepted), /does not match/);
  assert.throws(() => validateResponse({ ...response, result: { state: 'failed' } }, accepted), /invalid/);
});
