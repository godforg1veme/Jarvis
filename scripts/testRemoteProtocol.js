const assert = require('assert');
const {
  PROTOCOL_VERSION,
  createRemoteMessage,
  validateRemoteMessage,
} = require('../agents/remoteProtocol');

const hello = createRemoteMessage('device.hello', {
  deviceId: 'device-home-pc',
  token: 'test-token-not-a-secret',
  name: 'Home PC',
}, { id: 'hello-1' });
assert.strictEqual(hello.version, PROTOCOL_VERSION);
assert.strictEqual(hello.payload.deviceId, 'device-home-pc');

const command = createRemoteMessage('command.execute', {
  commandId: 'command-1',
  action: 'file.search',
  args: { query: 'report', location: 'computer' },
  confirmed: false,
});
assert.strictEqual(command.payload.action, 'file.search');
assert.strictEqual(command.payload.confirmed, false);

const visionCommand = createRemoteMessage('command.execute', {
  commandId: 'command-vision',
  action: 'vision.capture',
  args: { prompt: 'Что сейчас видно?', target: 'all' },
  confirmed: false,
});
assert.strictEqual(visionCommand.payload.args.target, 'all');
assert.throws(() => createRemoteMessage('command.execute', {
  commandId: 'command-vision-start',
  action: 'vision.capture',
  args: { prompt: 'Включи камеру', target: 'camera', startLease: true },
}), /unknown argument/);

const workflowUpdate = createRemoteMessage('workflow.update', {
  workflowId: 'workflow-1',
  status: 'completed',
  answer: 'Папка открыта.',
});
assert.strictEqual(workflowUpdate.payload.answer, 'Папка открыта.');
assert.throws(() => createRemoteMessage('workflow.update', {
  workflowId: 'workflow-1', status: 'completed', answer: '',
}), /answer is required/);

const lifeProposal = createRemoteMessage('life.proposal', {
  proposalId: 'proposal-1', title: 'Вернуться к Life OS',
  explanation: 'Есть открытая договорённость.', risk: 'safe',
});
assert.strictEqual(lifeProposal.payload.risk, 'safe');
assert.throws(() => createRemoteMessage('life.proposal', { proposalId: 'proposal-1', title: '', risk: 'safe' }), /title is required/);

const lifeReminder = createRemoteMessage('life.reminder', {
  reminderId: 'reminder-1', title: 'Продолжить Life OS',
});
assert.strictEqual(lifeReminder.payload.title, 'Продолжить Life OS');
assert.throws(() => createRemoteMessage('life.reminder', { reminderId: 'reminder-1', title: '' }), /title is required/);
assert.deepStrictEqual(createRemoteMessage('life.reminder', {
  reminderId: 'reminder-1', title: 'Тест', actionArguments: { command: 'hidden' },
}).payload, { reminderId: 'reminder-1', title: 'Тест' });

assert.throws(() => validateRemoteMessage({ version: 2, type: 'device.heartbeat', payload: {} }), /unsupported/);
assert.throws(() => createRemoteMessage('device.hello', { deviceId: 'x', token: '' }), /token is required/);
assert.throws(() => createRemoteMessage('command.execute', {
  commandId: 'command-2',
  action: 'file.copy',
  args: { from: 'a' },
}), /destination is required/);
assert.throws(() => createRemoteMessage('command.execute', {
  commandId: 'command-3',
  action: 'process.shell',
  args: {},
}), /unknown tool action/);

console.log('[testRemoteProtocol] remote protocol tests passed');
