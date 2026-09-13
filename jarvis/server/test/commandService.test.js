const assert = require('node:assert/strict');
const test = require('node:test');
const { CommandService } = require('../src/commands/commandService');
const { POLICY } = require('../src/commands/commandSchemas');

const userId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';

function harness() {
  const calls = [];
  const commands = new Map();
  const device = {
    id: deviceId,
    user_id: userId,
    status: 'online',
    capabilities: { actions: ['file.search', 'file.open', 'file.open_folder', 'file.delete'] },
  };
  const repository = {
    async create(input) {
      calls.push(['create', input]);
      commands.set(input.id, input);
      return {
        command: {
          id: input.id,
          user_id: input.userId,
          device_id: input.deviceId,
          action: input.action,
          arguments: input.args,
          policy: input.policy,
          status: input.status,
        },
        confirmation: input.status === 'awaiting_confirmation' ? { prompt: input.prompt } : null,
      };
    },
    async approve() {
      calls.push(['approve']);
      return {
        id: '33333333-3333-4333-8333-333333333333',
        user_id: userId,
        device_id: deviceId,
        action: 'file.delete',
        arguments: { path: 'C:\\Temp\\old.txt' },
        policy: POLICY.CONFIRM,
        status: 'queued',
      };
    },
    async markRunning(input) {
      calls.push(['running', input]);
      const created = commands.get(input.commandId) || {};
      return {
        id: input.commandId,
        user_id: userId,
        device_id: deviceId,
        action: created.action || 'file.delete',
        arguments: created.args || { path: 'C:\\Temp\\old.txt' },
        policy: created.policy || POLICY.CONFIRM,
        status: 'running',
      };
    },
    async fail(input) { calls.push(['fail', input]); return { ...input, status: 'failed' }; },
    async audit(input) { calls.push(['audit', input]); },
    async getForDevice() { return null; },
  };
  const sent = [];
  const service = new CommandService({
    repository,
    deviceRepository: { async listForUser() { return [device]; } },
    sessionRegistry: { send(_device, message) { sent.push(message); return true; } },
  });
  return { calls, sent, service };
}

test('changing remote action is persisted awaiting confirmation and dispatched only after approval', async () => {
  const { calls, sent, service } = harness();
  const created = await service.create({
    userId,
    deviceId,
    originChannel: 'telegram',
    action: 'file.delete',
    args: { path: 'C:\\Temp\\old.txt' },
  });
  assert.equal(created.status, 'awaiting_confirmation');
  assert.equal(sent.length, 0);
  assert.match(created.prompt, /Удалить в корзину/);
  assert.ok(!created.prompt.includes('candidateId'));

  const approved = await service.approve({ userId, commandId: '33333333-3333-4333-8333-333333333333', originChannel: 'telegram' });
  assert.equal(approved.status, 'running');
  assert.equal(sent[0].type, 'command.execute');
  assert.equal(sent[0].payload.confirmed, true);
  assert.ok(calls.some(([type]) => type === 'approve'));
});

test('safe remote action is dispatched without a confirmation', async () => {
  const { sent, service } = harness();
  const result = await service.create({
    userId,
    deviceId,
    originChannel: 'desktop',
    action: 'file.search',
    args: { query: 'report' },
  });
  assert.equal(result.status, 'running');
  assert.equal(sent[0].payload.confirmed, false);
});

test('opening a verified folder is dispatched without a confirmation', async () => {
  const { sent, service } = harness();
  const result = await service.create({
    userId,
    deviceId,
    originChannel: 'desktop',
    action: 'file.open_folder',
    args: { path: 'C:\\Users\\Max\\Documents' },
  });
  assert.equal(result.status, 'running');
  assert.equal(sent[0].payload.action, 'file.open_folder');
  assert.equal(sent[0].payload.confirmed, false);
});

test('opening a normal path is safe while a BAT path still requires origin confirmation', async () => {
  const safeHarness = harness();
  const safe = await safeHarness.service.create({
    userId,
    deviceId,
    originChannel: 'desktop',
    action: 'file.open',
    args: { path: 'C:\\Users\\Max\\Documents\\notes.txt' },
  });
  assert.equal(safe.status, 'running');
  assert.equal(safeHarness.sent[0].payload.confirmed, false);

  const dangerousHarness = harness();
  const dangerous = await dangerousHarness.service.create({
    userId,
    deviceId,
    originChannel: 'desktop',
    action: 'file.open',
    args: { path: 'C:\\Users\\Max\\Desktop\\run.bat' },
  });
  assert.equal(dangerous.status, 'awaiting_confirmation');
  assert.equal(dangerousHarness.sent.length, 0);
});

test('the orchestrator may lower only an opaque verified-safe file candidate', async () => {
  const { sent, service } = harness();
  const result = await service.create({
    userId,
    deviceId,
    originChannel: 'desktop',
    action: 'file.open',
    args: { candidateId: 'candidate-file-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    trustedPolicy: POLICY.LOW_RISK,
  });
  assert.equal(result.status, 'running');
  assert.equal(sent[0].payload.confirmed, false);

  await assert.rejects(
    service.create({
      userId,
      deviceId,
      originChannel: 'desktop',
      action: 'file.delete',
      args: { path: 'C:\\Temp\\old.txt' },
      trustedPolicy: POLICY.LOW_RISK,
    }),
    /invalid trusted command policy override/,
  );
});

test('remote action cannot target an unsupported device capability', async () => {
  const { service } = harness();
  await assert.rejects(
    service.create({ userId, deviceId, originChannel: 'desktop', action: 'app.close', args: { appId: 'browser' } }),
    /ACTION_UNSUPPORTED_BY_DEVICE/,
  );
});
