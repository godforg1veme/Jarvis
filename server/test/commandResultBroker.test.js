const assert = require('node:assert/strict');
const test = require('node:test');
const { CommandResultBroker } = require('../src/orchestrator/commandResultBroker');

test('result broker wakes a waiter only after a terminal persisted command is notified', async () => {
  const broker = new CommandResultBroker();
  const pending = broker.wait('command-1', { timeoutMs: 100 });
  broker.notify({ id: 'command-1', status: 'running' });
  broker.notify({ id: 'command-1', status: 'succeeded', result: { ok: true } });
  const result = await pending;
  assert.equal(result.status, 'succeeded');
});

test('result broker closes the result-before-wait race with a bounded cache', async () => {
  const broker = new CommandResultBroker();
  broker.notify({ id: 'command-2', status: 'failed', result: { ok: false } });
  const result = await broker.wait('command-2', { timeoutMs: 10 });
  assert.equal(result.status, 'failed');
});
