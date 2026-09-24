const test = require('node:test');
const assert = require('node:assert/strict');
const { SourceSyncService } = require('../src/life/sources/sourceSyncService');
const { createFixtureSourceRegistry } = require('../src/life/sources/fixtureSourceRegistry');

const USER = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const item = { id: 'task-1', title: 'Продолжить Life OS', state: 'open', dueAt: '2026-09-15T10:00:00Z', updatedAt: '2026-09-14T10:00:00Z' };
function repository(options = {}) { const calls = []; return { calls,
  async get(input) { calls.push(['get', input]); return { id: CONNECTION, adapter_type: 'tasks', enabled: true, selected_scope: {} }; },
  async ensureCursor(input) { calls.push(['ensure', input]); return {}; },
  async claimCursor(input) { calls.push(['claim', input]); return { claimToken: 'claim', cursor: { cursor_value: 'initial' } }; },
  async commitCursor(input) { calls.push(['commit', input]); return options.commit === false ? null : {}; },
  async releaseCursor(input) { calls.push(['release', input]); return true; },
  async recordHealth(input) { calls.push(['health', input]); return true; },
}; }

test('sync commits cursor only after every normalized event is accepted and replay keeps its key', async () => {
  const repo = repository(); const events = [];
  const service = new SourceSyncService({ repository: repo, registry: createFixtureSourceRegistry({ tasks: { initial: { items: [item], nextCursor: 'page-2', done: false } } }),
    gateway: { async record(input) { events.push(input); return { id: 'event' }; } }, enabled: true });
  const first = await service.sync({ userId: USER, connectionId: CONNECTION });
  assert.equal(first.accepted, 1); assert.equal(repo.calls.findIndex(([name]) => name === 'commit') > repo.calls.findIndex(([name]) => name === 'claim'), true);
  assert.equal(events[0].userId, USER); assert.doesNotMatch(JSON.stringify(events[0]), /body|password|cursor_value/);
});

test('event or cursor failure releases the same claim and does not advance cursor', async () => {
  const repo = repository();
  const service = new SourceSyncService({ repository: repo, registry: createFixtureSourceRegistry({ tasks: { initial: { items: [item], nextCursor: 'page-2' } } }),
    gateway: { async record() { return null; } }, enabled: true });
  const result = await service.sync({ userId: USER, connectionId: CONNECTION });
  assert.equal(result.status, 'failed');
  assert.equal(repo.calls.some(([name]) => name === 'commit'), false);
  assert.equal(repo.calls.find(([name]) => name === 'release')[1].claimToken, 'claim');
});

test('fixture source transport is disabled by default and never touches a repository', async () => {
  const service = new SourceSyncService({ enabled: false });
  assert.deepEqual(await service.sync({ userId: USER, connectionId: CONNECTION }), { status: 'fixture_disabled', accepted: 0 });
});
