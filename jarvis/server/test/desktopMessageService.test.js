const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DesktopMessageService,
  DesktopRequestPendingError,
} = require('../src/desktop/desktopMessageService');

function harness(requestResult = { created: true, request: { id: 1, status: 'processing' } }, devices = []) {
  const calls = { requests: [], conversations: [], messages: [], answers: [] };
  const service = new DesktopMessageService({
    requestRepository: {
      async claim(input) { calls.requests.push({ type: 'claim', ...input }); return requestResult; },
      async complete(input) { calls.requests.push({ type: 'complete', ...input }); },
      async fail(input) { calls.requests.push({ type: 'fail', ...input }); },
    },
    conversationRepository: {
      async getOrCreate(input) { calls.conversations.push(input); return { id: 'desktop-conversation' }; },
      async appendMessage(input) { calls.messages.push(input); return { id: `message-${calls.messages.length}` }; },
      async recentMessages() { return [{ role: 'user', content: 'привет' }]; },
    },
    assistant: {
      async answer(input) { calls.answers.push(input); return 'Здравствуйте!'; },
    },
    deviceService: {
      async list({ userId }) { return devices.filter((device) => device.user_id === userId); },
    },
  });
  return { service, calls };
}

test('Desktop text is persisted and answered only inside the authenticated device owner scope', async () => {
  const { service, calls } = harness();
  const result = await service.handle({
    device: { id: 'device-a', user_id: 'user-a' },
    clientMessageId: 'request-a',
    resolveContent: async () => ({ content: 'Привет' }),
  });

  assert.equal(result.answer, 'Здравствуйте!');
  assert.deepEqual(calls.conversations[0], { userId: 'user-a', channel: 'desktop', externalChatId: 'device-a' });
  assert.equal(calls.messages[0].userId, 'user-a');
  assert.equal(calls.answers[0].runtimeContext.channel, 'desktop');
  assert.equal(calls.requests.at(-1).type, 'complete');
});

test('completed duplicate Desktop requests return the original response without another model call', async () => {
  const { service, calls } = harness({
    created: false,
    request: { status: 'completed', response: { status: 'answered', answer: 'cached' } },
  });
  const result = await service.handle({
    device: { id: 'device-a', user_id: 'user-a' },
    clientMessageId: 'request-a',
    resolveContent: async () => ({ content: 'ignored' }),
  });
  assert.equal(result.answer, 'cached');
  assert.equal(result.duplicate, true);
  assert.equal(calls.answers.length, 0);
});

test('in-flight duplicate Desktop requests do not invoke the model twice', async () => {
  const { service, calls } = harness({ created: false, request: { status: 'processing' } });
  await assert.rejects(
    service.handle({
      device: { id: 'device-a', user_id: 'user-a' },
      clientMessageId: 'request-a',
      resolveContent: async () => ({ content: 'ignored' }),
    }),
    DesktopRequestPendingError,
  );
  assert.equal(calls.answers.length, 0);
});

test('Desktop passes its owner-scoped device snapshot to the provider', async () => {
  const { service, calls } = harness(undefined, [
    { user_id: 'user-a', name: 'Мой компьютер', status: 'online' },
    { user_id: 'user-b', name: 'Другой компьютер', status: 'online' },
  ]);
  await service.handle({
    device: { id: 'device-a', user_id: 'user-a' },
    clientMessageId: 'request-a',
    resolveContent: async () => ({ content: 'Расскажи о моих подключённых устройствах' }),
  });
  assert.deepEqual(calls.answers[0].devices, [{ user_id: 'user-a', name: 'Мой компьютер', status: 'online' }]);
});

test('Desktop answers an attachment question without calling the model', async () => {
  const { service, calls } = harness(undefined, [
    { user_id: 'user-a', name: 'Мой компьютер', status: 'online' },
  ]);
  const result = await service.handle({
    device: { id: 'device-a', user_id: 'user-a' },
    clientMessageId: 'request-a',
    resolveContent: async () => ({ content: 'К какому ПК я привязан?' }),
  });
  assert.equal(result.answer, 'К твоему аккаунту привязан компьютер «Мой компьютер» — online.');
  assert.equal(calls.answers.length, 0);
});
