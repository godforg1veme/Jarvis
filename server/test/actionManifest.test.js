const assert = require('node:assert/strict');
const test = require('node:test');
const { createActionManifest } = require('../src/orchestrator/actionManifest');
const { DesktopCommandExecutor, ExecutorRegistry, ServerActionExecutor } = require('../src/orchestrator/executorRegistry');

test('action manifest exposes only validated command actions with executor metadata', () => {
  const manifest = createActionManifest();
  const search = manifest.require('file.search');
  assert.equal(search.executorType, 'device');
  assert.equal(search.validateArgs({ query: 'Tabletop Simulator', targetType: 'directory' }).query, 'Tabletop Simulator');
  assert.throws(() => manifest.require('server.shell'));
  assert.throws(() => search.validateArgs({}));
  assert.throws(() => manifest.require('window.list').validateArgs({ deviceId: 'model-invented' }), /unknown argument/);
});

test('server executor scopes resources to the authenticated owner and never retries unknown workflows', async () => {
  const users = [];
  const executor = new ServerActionExecutor({
    deviceRepository: { async listForUser(userId) { users.push(userId); return [{ id: 'device', name: 'PC', status: 'online' }]; } },
    workflowRepository: { async getForUser({ userId }) { users.push(userId); return { id: 'workflow', status: 'outcome_unknown' }; } },
  });
  const status = await executor.execute({ userId: 'owner', action: 'device.status.request', args: { deviceId: 'device' } });
  assert.equal(status.result.device.status, 'online');
  const uncertain = await executor.execute({ userId: 'owner', action: 'workflow.continue', args: { workflowId: 'workflow' } });
  assert.equal(uncertain.status, 'outcome_unknown');
  assert.deepEqual(users, ['owner', 'owner']);
});

test('Life OS actions are frozen, strict, and proposal-only', () => {
  const manifest = createActionManifest();
  const names = ['reminder.create', 'reminder.reschedule', 'life.commitment.reschedule', 'life.task.create',
    'project.show_documents', 'device.status.request', 'workflow.continue', 'workspace.prepare'];
  for (const name of names) assert.equal(manifest.require(name).proposalOnly, true);
  assert.equal(manifest.require('project.show_documents').policy, 'observe');
  assert.equal(manifest.require('reminder.create').policy, 'requires_confirmation');
  assert.throws(() => manifest.require('workspace.prepare').validateArgs({ projectId: '11111111-1111-4111-8111-111111111111', shell: 'whoami' }));
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
