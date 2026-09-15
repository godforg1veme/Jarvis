const assert = require('node:assert/strict');
const test = require('node:test');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');
const { FixedWindowRateLimiter, RateLimitError } = require('../src/http/rateLimiter');
const {
  MAX_TELEGRAM_VOICE_BYTES,
  TelegramMessageService,
  normalizeTelegramMessage,
  parseRemoteCommand,
} = require('../src/telegram/messageService');

function update(id, userId, chatId, text) {
  return {
    update_id: id,
    message: {
      message_id: id + 100,
      from: { id: userId, first_name: `User ${userId}` },
      chat: { id: chatId },
      text,
    },
  };
}

function callbackUpdate(id, userId, chatId, data) {
  return {
    update_id: id,
    callback_query: {
      id: `callback-${id}`,
      from: { id: userId, first_name: `User ${userId}` },
      message: { message_id: id + 100, chat: { id: chatId } },
      data,
    },
  };
}

function voiceUpdate(id, userId, chatId, overrides = {}) {
  return {
    update_id: id,
    message: {
      message_id: id + 100,
      from: { id: userId, first_name: `User ${userId}` },
      chat: { id: chatId },
      voice: {
        file_id: 'voice-id',
        file_unique_id: 'voice-unique',
        file_size: 24,
        mime_type: 'audio/ogg',
        duration: 3,
        ...overrides,
      },
    },
  };
}

test('normalizes media-only Telegram messages without treating them as plain text', () => {
  const input = normalizeTelegramMessage({
    update_id: 1,
    message: {
      message_id: 2,
      from: { id: 101, first_name: 'User' },
      chat: { id: 101 },
      audio: { file_id: 'audio-id', file_unique_id: 'audio-unique', file_size: 12, mime_type: 'audio/ogg', duration: 4 },
    },
  });
  assert.equal(input.text, '');
  assert.equal(input.attachment.category, 'audio');
  assert.equal(input.voice, null);
});

test('normalizes a Telegram voice note separately from ordinary attachments', () => {
  const input = normalizeTelegramMessage(voiceUpdate(2, 101, 101));
  assert.equal(input.voice.mediaType, 'audio/ogg');
  assert.equal(input.voice.durationSeconds, 3);
  assert.equal(input.attachment.category, 'audio');
});

function harness(allowedIds = ['101', '202'], devices = null, commandService = null, options = {}) {
  const state = { updates: new Set(), users: new Map(), conversations: new Map(), messages: [] };
  const assistantCalls = [];
  const service = new TelegramMessageService({
    accessPolicy: createTelegramAccessPolicy(allowedIds),
    updateRepository: {
      async claim(updateId) {
        if (state.updates.has(updateId)) return false;
        state.updates.add(updateId);
        return true;
      },
    },
    userRepository: {
      async findOrCreateTelegramUser({ telegramUserId, displayName }) {
        if (!state.users.has(telegramUserId)) state.users.set(telegramUserId, { id: `user-${telegramUserId}`, display_name: displayName });
        return state.users.get(telegramUserId);
      },
    },
    conversationRepository: {
      async getOrCreate({ userId, externalChatId }) {
        const key = `${userId}:${externalChatId}`;
        if (!state.conversations.has(key)) state.conversations.set(key, { id: `conversation-${key}`, user_id: userId });
        return state.conversations.get(key);
      },
      async appendMessage(message) {
        state.messages.push(message);
        return message;
      },
      async recentMessages({ userId, conversationId, limit }) {
        return state.messages
          .filter((message) => message.userId === userId && message.conversationId === conversationId)
          .slice(-limit);
      },
    },
    assistant: {
      async answer(input) {
        assistantCalls.push(input);
        return `answer:${input.currentRequest}`;
      },
    },
    ...(devices ? {
      deviceService: {
        async list({ userId }) {
          return devices.filter((device) => device.user_id === userId);
        },
      },
    } : {}),
    ...(commandService ? { commandService } : {}),
    ...(options.knowledgeService ? { knowledgeService: options.knowledgeService } : {}),
    ...(options.asr ? { asr: options.asr } : {}),
    ...(options.voiceLimiter ? { voiceLimiter: options.voiceLimiter } : {}),
    ...(options.vpnService ? { vpnService: options.vpnService } : {}),
    ...(options.vpnSupervisorService ? { vpnSupervisorService: options.vpnSupervisorService } : {}),
    ...(options.menuService ? { menuService: options.menuService } : {}),
    ...(options.orchestrator ? { orchestrator: options.orchestrator } : {}),
    ...(options.lifeReminderService ? { lifeReminderService: options.lifeReminderService } : {}),
  });
  return { service, state, assistantCalls };
}

test('routes the closed VPN Supervisor command and callbacks without invoking the assistant', async () => {
  const calls = [];
  const supervisor = {
    async handleCommand(input) { calls.push(['command', input]); return input.text === '/vpn_supervisor_test' ? { answer: 'proposal', buttons: [[{ text: 'Allow', data: 'vpsup:allow:11111111-1111-4111-8111-111111111111' }]] } : null; },
    async handleCallback(input) { calls.push(['callback', input]); return { answer: 'completed' }; },
  };
  const { service, assistantCalls } = harness(['101'], null, null, { vpnSupervisorService: supervisor });
  const command = await service.handle(update(880, 101, 101, '/vpn_supervisor_test'));
  assert.equal(command.answer, 'proposal');
  const callback = await service.handleCallback(callbackUpdate(881, 101, 101, 'vpsup:allow:11111111-1111-4111-8111-111111111111'));
  assert.equal(callback.answer, 'completed');
  assert.equal(assistantCalls.length, 0);
  assert.equal(calls[0][1].telegramUserId, '101');
  assert.equal(calls[1][1].telegramUserId, '101');
});

test('rejects a disallowed identity before persistence', async () => {
  const { service, state } = harness();
  const result = await service.handle(update(1, 999, 999, 'secret'));
  assert.equal(result.status, 'forbidden');
  assert.equal(state.updates.size, 0);
  assert.equal(state.users.size, 0);
  assert.equal(state.messages.length, 0);
});

test('deduplicates Telegram updates', async () => {
  const { service, state } = harness();
  assert.equal((await service.handle(update(2, 101, 101, 'hello'))).status, 'answered');
  assert.equal((await service.handle(update(2, 101, 101, 'hello'))).status, 'duplicate');
  assert.equal(state.messages.length, 2);
});

test('Telegram reminder acknowledgement is bound to the authenticated owner and conversation', async () => {
  const calls = [];
  const reminderId = '11111111-1111-4111-8111-111111111111';
  const { service } = harness(['101'], null, null, {
    lifeReminderService: {
      async acknowledgeLatest(input) { calls.push(input); return { id: reminderId }; },
    },
  });
  const result = await service.handleCallback(callbackUpdate(900, 101, 101, `life:reminder:ack:${reminderId}`));
  assert.equal(result.answer, 'Напоминание отмечено выполненным.');
  assert.equal(calls[0].userId, 'user-101');
  assert.equal(calls[0].originConversationId, 'conversation-user-101:101');
  assert.equal(calls[0].reminderId, reminderId);
});

test('transcribes an allowed Telegram voice without storing raw audio', async () => {
  const rawAudio = Buffer.from('private-voice-bytes');
  const asrCalls = [];
  const ingestionCalls = [];
  const { service, state, assistantCalls } = harness(['101'], null, null, {
    asr: {
      async transcribe(input) {
        asrCalls.push(input);
        return { text: 'открой список задач', language: 'ru' };
      },
    },
    knowledgeService: {
      async ingest(input) { ingestionCalls.push(input); },
      async searchForPrompt() { return []; },
    },
  });

  const result = await service.handle(voiceUpdate(31, 101, 101), {
    async downloadVoice(voice) {
      assert.equal(voice.fileId, 'voice-id');
      return rawAudio;
    },
    async downloadAttachment() { throw new Error('voice must not enter attachment storage'); },
  });

  assert.equal(result.answer, 'answer:открой список задач');
  assert.equal(asrCalls.length, 1);
  assert.equal(asrCalls[0].audio, rawAudio);
  assert.equal(asrCalls[0].mimeType, 'audio/ogg');
  assert.equal(asrCalls[0].languageHint, 'ru');
  assert.equal(ingestionCalls.length, 0);
  assert.deepEqual(state.messages.map((message) => ({ role: message.role, contentType: message.contentType, content: message.content })), [
    { role: 'user', contentType: 'voice_transcript', content: 'открой список задач' },
    { role: 'assistant', contentType: undefined, content: 'answer:открой список задач' },
  ]);
  assert.equal(state.messages.some((message) => String(message.content).includes(rawAudio.toString())), false);
  assert.equal(assistantCalls[0].currentRequest, 'открой список задач');
});

test('keeps a Telegram voice in attachment ingestion while voice ASR is disabled', async () => {
  const ingested = [];
  const { service, state } = harness(['101'], null, null, {
    knowledgeService: {
      async ingest(input) {
        ingested.push(input);
        return { originalName: 'voice-unique', name: 'voice-unique' };
      },
    },
  });
  const result = await service.handle(voiceUpdate(32, 101, 101), {
    async downloadAttachment() { return Buffer.from('voice-as-document'); },
    async downloadVoice() { throw new Error('disabled ASR must not download voice for transcription'); },
  });

  assert.match(result.answer, /Индексирую/);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].attachment.category, 'audio');
  assert.equal(state.messages[0].contentType, 'document');
});

test('rejects oversized or over-duration Telegram voice before downloading it', async () => {
  let downloads = 0;
  const { service } = harness(['101'], null, null, {
    asr: { async transcribe() { return { text: 'unused' }; } },
  });
  await assert.rejects(
    service.handle(voiceUpdate(33, 101, 101, { duration: 121 }), {
      async downloadVoice() { downloads += 1; return Buffer.from('unused'); },
    }),
    /duration is invalid/,
  );
  await assert.rejects(
    service.handle(voiceUpdate(34, 101, 101, { file_size: MAX_TELEGRAM_VOICE_BYTES + 1 }), {
      async downloadVoice() { downloads += 1; return Buffer.from('unused'); },
    }),
    /too large/,
  );
  assert.equal(downloads, 0);
});

test('throttles Telegram voice per owner before additional downloads', async () => {
  const limiter = new FixedWindowRateLimiter({ now: () => 1000 });
  const { service } = harness(['101'], null, null, {
    asr: { async transcribe() { return { text: 'коротко' }; } },
    voiceLimiter: limiter,
  });
  let downloads = 0;
  for (const id of [35, 36, 37]) {
    await service.handle(voiceUpdate(id, 101, 101), {
      async downloadVoice() { downloads += 1; return Buffer.from('voice'); },
    });
  }
  await assert.rejects(
    service.handle(voiceUpdate(38, 101, 101), {
      async downloadVoice() { downloads += 1; return Buffer.from('voice'); },
    }),
    (error) => error instanceof RateLimitError,
  );
  assert.equal(downloads, 3);
});

test('isolates conversations for two Telegram users', async () => {
  const { service, state } = harness();
  await service.handle(update(3, 101, 777, 'one'));
  await service.handle(update(4, 202, 777, 'two'));

  assert.equal(state.users.size, 2);
  assert.equal(state.conversations.size, 2);
  assert.deepEqual(new Set(state.messages.map((message) => message.userId)), new Set(['user-101', 'user-202']));
});

test('handles built-in commands without calling the model', async () => {
  const { service, assistantCalls } = harness();
  const result = await service.handle(update(5, 101, 101, '/devices'));
  assert.equal(result.answer, 'Устройства пока не подключены.');
  assert.equal(assistantCalls.length, 0);
});

test('routes start and exact bottom-menu labels without storing presentation text as user conversation', async () => {
  const menuCalls = [];
  const menuService = {
    async handleMenuAction(action, context) {
      menuCalls.push({ action, telegramUserId: context.telegramUserId, userId: context.userId, conversationId: context.conversationId });
      return { answer: `menu:${action}`, replyKeyboard: { keyboard: [[{ text: '🏠 Главное' }]], resize_keyboard: true, is_persistent: true } };
    },
    async handlePendingText() { return null; },
    async handleCallback() { return null; },
  };
  const { service, state, assistantCalls } = harness(['101'], null, null, { menuService });
  const started = await service.handle(update(70, 101, 101, '/start'));
  const devices = await service.handle(update(71, 101, 101, '🖥 Устройства'));
  assert.equal(started.answer, 'menu:home');
  assert.equal(devices.answer, 'menu:devices');
  assert.deepEqual(menuCalls.map((call) => call.action), ['home', 'devices']);
  assert.equal(menuCalls[0].userId, 'user-101');
  assert.equal(menuCalls[0].conversationId, 'conversation-user-101:101');
  assert.equal(state.messages.some((message) => message.role === 'user'), false);
  assert.equal(assistantCalls.length, 0);
});

test('routes validated menu callbacks before legacy callback handlers', async () => {
  const menuService = {
    async handleCallback(data) { return data === 'mem:list' ? { answer: 'Память открыта.' } : null; },
  };
  const { service, state } = harness(['101'], null, null, { menuService });
  const result = await service.handleCallback(callbackUpdate(72, 101, 101, 'mem:list'));
  assert.equal(result.answer, 'Память открыта.');
  assert.equal(state.messages.at(-1).content, 'Память открыта.');
});

test('guided Desktop text reaches the orchestrator with the selected owned device', async () => {
  const selectedDeviceId = '22222222-2222-4222-8222-222222222222';
  const orchestratorCalls = [];
  const menuService = {
    async handlePendingText(text) { return { desktopInstruction: { text, preferredDeviceId: selectedDeviceId } }; },
    async handleCallback() { return null; },
  };
  const orchestrator = {
    async handle(input) { orchestratorCalls.push(input); return { handled: true, answer: 'Поручение принято.' }; },
  };
  const { service, state } = harness(['101'], null, null, { menuService, orchestrator });
  const result = await service.handle(update(73, 101, 101, 'Найди отчёт'));
  assert.equal(result.answer, 'Поручение принято.');
  assert.equal(orchestratorCalls[0].preferredDeviceId, selectedDeviceId);
  assert.equal(state.messages.some((message) => message.role === 'user' && message.content === 'Найди отчёт'), true);
});

test('routes identity questions through the canonical assistant service', async () => {
  const { service, assistantCalls } = harness();
  const result = await service.handle(update(9, 101, 101, 'Кто ты и как тебя зовут?'));
  assert.equal(result.answer, 'answer:Кто ты и как тебя зовут?');
  assert.equal(assistantCalls.length, 1);
  assert.equal(assistantCalls[0].userId, 'user-101');
  assert.equal(assistantCalls[0].conversationId, 'conversation-user-101:101');
  assert.equal(assistantCalls[0].runtimeContext.channel, 'telegram');
});

test('passes only the current user conversation history to the provider', async () => {
  const { service, assistantCalls } = harness();
  await service.handle(update(6, 101, 101, 'первый вопрос'));
  await service.handle(update(7, 202, 202, 'чужой вопрос'));
  await service.handle(update(8, 101, 101, 'второй вопрос'));

  assert.deepEqual(assistantCalls[2].history.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: 'первый вопрос' },
    { role: 'assistant', content: 'answer:первый вопрос' },
    { role: 'user', content: 'второй вопрос' },
  ]);
  assert.equal(assistantCalls[2].currentRequest, 'второй вопрос');
  assert.equal(assistantCalls[2].runtimeContext.channel, 'telegram');
});

test('passes only the current user device snapshot to the provider', async () => {
  const { service, assistantCalls } = harness(['101', '202'], [
    { user_id: 'user-101', name: 'ПК Максима', status: 'online', token_hash: 'do-not-pass' },
    { user_id: 'user-202', name: 'Чужой ПК', status: 'offline' },
  ]);
  await service.handle(update(10, 101, 101, 'Расскажи о моих подключённых устройствах'));
  assert.deepEqual(assistantCalls[0].devices, [{ user_id: 'user-101', name: 'ПК Максима', status: 'online', token_hash: 'do-not-pass' }]);
});

test('answers an attachment question from the owner-scoped device service without calling the model', async () => {
  const { service, assistantCalls } = harness(['101'], [
    { user_id: 'user-101', name: 'Мой компьютер', status: 'online' },
    { user_id: 'user-202', name: 'Чужой компьютер', status: 'offline' },
  ]);
  const result = await service.handle(update(11, 101, 101, 'К какому ПК я привязан?'));
  assert.equal(result.answer, 'К твоему аккаунту привязан компьютер «Мой компьютер» — online.');
  assert.equal(assistantCalls.length, 0);
});

test('parses only structured Telegram remote commands', () => {
  assert.deepEqual(parseRemoteCommand('/desktop 22222222-2222-4222-8222-222222222222 file.search {"query":"report"}'), {
    deviceId: '22222222-2222-4222-8222-222222222222',
    action: 'file.search',
    args: { query: 'report' },
  });
  assert.equal(parseRemoteCommand('/desktop device file.search {}'), null);
  assert.match(parseRemoteCommand('/desktop 22222222-2222-4222-8222-222222222222 file.search nope').error, /JSON/);
});

test('Telegram keeps changing remote actions behind an origin-channel confirmation', async () => {
  const calls = [];
  const { service } = harness(['101'], null, {
    async create(input) {
      calls.push(['create', input]);
      return {
        status: 'awaiting_confirmation',
        prompt: 'Подтвердить удалённое действие?',
        command: { id: '33333333-3333-4333-8333-333333333333' },
      };
    },
  });
  const result = await service.handle(update(12, 101, 101, '/desktop 22222222-2222-4222-8222-222222222222 file.delete {"path":"C:/Temp/old.txt"}'));
  assert.equal(result.answer, 'Подтвердить удалённое действие?');
  assert.ok(!result.answer.includes('33333333-3333-4333-8333-333333333333'));
  assert.equal(result.buttons[0][0].data, 'cmd:confirm:33333333-3333-4333-8333-333333333333');
  assert.equal(result.buttons[0][1].data, 'cmd:reject:33333333-3333-4333-8333-333333333333');
  assert.equal(calls[0][1].originChannel, 'telegram');
  assert.equal(calls[0][1].userId, 'user-101');
});

test('Telegram returns a VPN artifact without persisting its secret content', async () => {
  const secret = 'vless://private-client@example.test:443?security=reality\n';
  const { service, state, assistantCalls } = harness(['101'], null, null, {
    vpnService: { async handle(input) {
      assert.equal(input.originChannel, 'telegram');
      return { answer: 'VPN-доступ создан.', artifact: { kind: 'happ-vless', filename: 'Phone-vpn-0123456789ab.txt', content: secret } };
    } },
  });
  const result = await service.handle(update(50, 101, 101, '/vpn_confirm 33333333-3333-4333-8333-333333333333'));
  assert.equal(result.artifact.content, secret);
  assert.equal(state.messages.some((message) => String(message.content).includes('vless://')), false);
  assert.equal(assistantCalls.length, 0);
});

test('Telegram VPN callback stays owner-scoped and persists no technical ID', async () => {
  const requestId = '33333333-3333-4333-8333-333333333333';
  const { service, state } = harness(['101'], null, null, {
    vpnService: { async handleCallback(input) {
      assert.equal(input.userId, 'user-101');
      assert.equal(input.originChannel, 'telegram');
      assert.equal(input.data, `vpn:confirm:${requestId}`);
      return { answer: 'VPN-доступ создан.', buttons: [[{ text: 'В меню', data: 'vpn:menu' }]] };
    } },
  });
  const result = await service.handleVpnCallback(callbackUpdate(51, 101, 101, `vpn:confirm:${requestId}`));
  assert.equal(result.status, 'answered');
  assert.equal(result.buttons[0][0].data, 'vpn:menu');
  assert.equal(state.messages.some((message) => String(message.content).includes(requestId)), false);
  assert.equal((await service.handleVpnCallback(callbackUpdate(51, 101, 101, `vpn:confirm:${requestId}`))).status, 'duplicate');
  assert.equal((await service.handleVpnCallback(callbackUpdate(52, 999, 999, 'vpn:menu'))).status, 'forbidden');
});
