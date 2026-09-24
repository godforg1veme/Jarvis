const assert = require('node:assert/strict');
const test = require('node:test');
const { OperationService } = require('../src/operations/actions/operationService');
const { OperationRepository } = require('../src/operations/repositories/operationRepository');

test('fixed operation is durably recorded before the Host Agent call', async () => {
  const order = [];
  const service = new OperationService({ hostId: 'host-1', repository: {
    async serviceCapability() { return { id: 'service-1' }; },
    async createOrGet(input) { order.push('record'); return { id: input.id, operation: input.operation, target_key: input.targetKey, request_fingerprint: input.fingerprint, created: true }; },
    async complete(input) { order.push('complete'); return { id: input.id, status: input.status }; },
  }, client: { async request() { order.push('agent'); return { result: { state: 'succeeded', data: {} } }; } } });
  const result = await service.serviceAction({ sessionId: 'session-1', serviceKey: 'jarvis-server', action: 'restart', idempotencyKey: 'unique-operation-key-1' });
  assert.equal(result.status, 'succeeded'); assert.deepEqual(order, ['record', 'agent', 'complete']);
});

test('disabled service action never reaches Host Agent', async () => {
  let called = false; const service = new OperationService({ hostId: 'host-1', repository: { async serviceCapability() { return null; } }, client: { async request() { called = true; } } });
  await assert.rejects(service.serviceAction({ sessionId: 's', serviceKey: 'postgres', action: 'stop', idempotencyKey: 'unique-operation-key-2' }), (error) => error.code === 'SERVICE_ACTION_DISABLED');
  assert.equal(called, false);
});

test('reconciliation records a journaled result without repeating the action', async () => {
  const completed = []; let requests = 0;
  const service = new OperationService({ hostId: 'host-1', repository: {
    async recoverable() { return [{ id: '11111111-1111-4111-8111-111111111111', created_at: new Date() }]; },
    async complete(value) { completed.push(value); },
  }, client: { async request(request) { requests += 1; assert.equal(request.operation, 'operation.status'); return { result: { state: 'succeeded', data: { found: true, response: { result: { state: 'succeeded', data: { output: '' } } } } } }; } } });
  await service.reconcile();
  assert.equal(requests, 1); assert.equal(completed[0].status, 'succeeded');
});

test('operation completion returns the existing terminal row after a reconciliation race', async () => {
  let calls = 0; const repository = new OperationRepository({ async query() { calls += 1; return calls === 1 ? { rows: [] } : { rows: [{ id: 'operation-1', status: 'succeeded' }] }; } });
  assert.deepEqual(await repository.complete({ id: 'operation-1', status: 'succeeded' }), { id: 'operation-1', status: 'succeeded' });
  assert.equal(calls, 2);
});
