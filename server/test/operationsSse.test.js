const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { SseHub } = require('../src/operations/sseHub');
const { redactOperationalLog } = require('../src/operations/routes/readRoutes');

test('operational logs redact JSON secrets, Telegram bot credentials and URL passwords', () => {
  const text = redactOperationalLog('{"token":"fixture-secret","prompt":"private family text"} https://user:fixture-password@example.test 123456789:abcdefghijklmnopqrstuvwxyz123456789');
  for (const sensitive of ['fixture-secret', 'private family text', 'fixture-password', 'abcdefghijklmnopqrstuvwxyz123456789']) assert.equal(text.includes(sensitive), false);
});

class Response extends EventEmitter {
  constructor() { super(); this.output = ''; this.ended = false; }
  write(value) { this.output += value; }
  end() { this.ended = true; }
}

test('SSE publishes summaries and closes every stream for a revoked session', () => {
  const hub = new SseHub({ heartbeatMs: 60000 });
  const response = new Response();
  hub.subscribe('session-1', response);
  hub.publish('snapshot', { observedAt: '2026-09-04T12:00:00.000Z' });
  assert.match(response.output, /event: snapshot/);
  hub.closeSession('session-1');
  assert.equal(response.ended, true);
  assert.equal(hub.clients.size, 0);
});

test('operations log output redacts common credential shapes', () => {
  const output = redactOperationalLog('token=private-value\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz');
  assert.doesNotMatch(output, /private-value|abcdefghijklmnopqrstuvwxyz/);
  assert.match(output, /REDACTED/);
});
