const assert = require('node:assert/strict');
const test = require('node:test');
const { createActionManifest } = require('../src/orchestrator/actionManifest');
const { DesktopCommandExecutor, ExecutorRegistry } = require('../src/orchestrator/executorRegistry');

test('action manifest exposes only validated command actions with executor metadata', () => {
  const manifest = createActionManifest();
  const search = manifest.require('file.search');
  assert.equal(search.executorType, 'device');
  assert.equal(search.validateArgs({ query: 'Tabletop Simulator', targetType: 'directory' }).query, 'Tabletop Simulator');
  assert.throws(() => manifest.require('server.shell'));
  assert.throws(() => search.validateArgs({}));
  assert.throws(() => manifest.require('window.list').validateArgs({ deviceId: 'model-invented' }), /unknown argument/);
});

test('executor registry is explicit and desktop adapter preserves workflow linkage', async () => {
  const seen = [];
  const registry = new ExecutorRegistry().register('device', new DesktopCommandExecutor({
    commandService: { async create(input) { seen.push(input); return { status: 'running' }; } },
  }));
  await registry.require('device').execute({
    userId: 'user', conversationId: 'conversation', originChannel: 'desktop',
    originDeviceId: 'origin', targetId: 'target', action: 'file.search', args: { query: 'x' },
    workflowId: 'workflow', actionRunId: 'run',
  });
  assert.equal(seen[0].workflowId, 'workflow');
  assert.equal(seen[0].actionRunId, 'run');
  assert.throws(() => registry.require('server'));
});
