const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { HostAgentClient } = require('../src/operations/hostAgentClient');

const request = {
  version: 1,
  requestId: '2d2f9f55-6859-49d9-b54d-9d42d4251d52',
  operation: 'host.snapshot',
  arguments: {},
  sentAt: '2026-09-04T10:00:00.000Z',
};

test('Host Agent client sends authenticated bounded envelopes and validates the reply', async () => {
  const socket = new EventEmitter();
  socket.setEncoding = () => {};
  socket.destroy = () => {};
  socket.end = (payload) => {
    assert.match(payload, /"auth":"[a-f0-9]{64}"/);
    queueMicrotask(() => {
      socket.emit('data', JSON.stringify({
        version: 1, requestId: request.requestId, operation: 'host.snapshot',
        receivedAt: request.sentAt, completedAt: request.sentAt, result: { state: 'succeeded', data: {} },
      }));
      socket.emit('end');
    });
  };
  const client = new HostAgentClient({
    socketPath: '/run/test.sock',
    authenticatorPath: '/run/auth',
    readFile: () => 'a'.repeat(32),
    connect: () => { queueMicrotask(() => socket.emit('connect')); return socket; },
  });
  const response = await client.request(request);
  assert.equal(response.result.state, 'succeeded');
});
