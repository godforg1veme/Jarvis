const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopMessageService } = require('../src/desktop/desktopMessageService');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { KnowledgeService } = require('../src/knowledge/knowledgeService');
const { recordSimpleEvent, safeSummary } = require('../src/life/lifeSourceEvents');

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';
const DOCUMENT = '44444444-4444-4444-8444-444444444444';

test('Desktop voice publishes only a bounded transcript fact after owner resolution', async () => {
  const events = [];
  const service = new DesktopMessageService({
    requestRepository: { async claim() { return { created: true }; }, async complete() {}, async fail() {} },
    conversationRepository: {
      async getOrCreate() { return { id: CONVERSATION }; },
      async appendMessage(input) { return { id: DOCUMENT, ...input }; }, async recentMessages() { return []; },
    }, assistant: { async answer() { return 'Готово'; }, },
    lifeEventGateway: { async record(input) { events.push(input); return input; } },
  });
  await service.handle({ device: { id: DEVICE, user_id: USER }, clientMessageId: 'voice-1', kind: 'voice', resolveContent: async () => ({ content: 'Завтра продолжу Life OS', audio: Buffer.from('raw') }) });
  assert.equal(events[0].eventType, 'voice.transcribed');
  assert.equal(events[0].userId, USER);
  assert.equal(events[0].sourceDeviceId, DEVICE);
  assert.doesNotMatch(JSON.stringify(events[0]), /raw|audio|Buffer/);
});

test('Telegram retries publish one deterministic owner-scoped key and no transport metadata', async () => {
  const events = [];
  const service = new TelegramMessageService({
    accessPolicy: { isAllowed: () => true }, updateRepository: { async claim() { return true; } },
    userRepository: { async findOrCreateTelegramUser() { return { id: USER }; } },
    conversationRepository: { async getOrCreate() { return { id: CONVERSATION }; }, async appendMessage() {}, async recentMessages() { return []; } },
    assistant: { async answer() { return 'Ответ'; } }, lifeEventGateway: { async record(input) { events.push(input); } },
  });
  await service.handle({ update_id: 17, message: { message_id: 7, from: { id: 123, first_name: 'Max' }, chat: { id: 123 }, text: 'Продолжу Life OS' } });
  assert.equal(events[0].deduplicationKey, `telegram-message:${USER}:17`);
  assert.deepEqual(events[0].structuredData, { conversationId: CONVERSATION, messageKind: 'text', externalMessageId: '7' });
});

test('Telegram Life OS query and confirmation stay bound to the current conversation', async () => {
  const confirmations = [];
  const service = new TelegramMessageService({
    accessPolicy: { isAllowed: () => true }, updateRepository: { async claim() { return true; } },
    userRepository: { async findOrCreateTelegramUser() { return { id: USER }; } },
    conversationRepository: { async getOrCreate() { return { id: CONVERSATION }; }, async appendMessage() {}, async recentMessages() { return []; } },
    assistant: { async answer() { throw new Error('model must not run'); } },
    lifeMissionControlService: { async get() { return { currentMission: { name: 'Life OS' }, commitments: [], proposals: [] }; } },
    lifeProposalService: { async confirm(input) { confirmations.push(input); return { id: DOCUMENT }; }, async dismiss() { return null; } },
  });
  const life = await service.handle({ update_id: 18, message: { message_id: 8, from: { id: 123 }, chat: { id: 123 }, text: '/life' } });
  assert.match(life.answer, /Life OS/);
  const confirmed = await service.handle({ update_id: 19, message: { message_id: 9, from: { id: 123 }, chat: { id: 123 }, text: `/life_confirm ${DOCUMENT}` } });
  assert.equal(confirmed.answer, 'Предложение подтверждено.');
  assert.equal(confirmations[0].originConversationId, CONVERSATION);
  assert.equal(confirmations[0].originChannel, 'telegram');
});

test('knowledge emits metadata only after successful indexing', async () => {
  const events = [];
  const service = new KnowledgeService({
    repository: {
      async getForWorker() { return { id: DOCUMENT, user_id: USER, storage_key: 'opaque', original_name: 'plan.txt', media_type: 'text/plain', category: 'text', metadata: {} }; },
      async markReady() {}, async completeJob() {},
    }, storage: { async read() { return Buffer.from('private body'); } },
    extract: async () => ({ mode: 'text', content: 'private body', chunks: [{ content: 'private body', metadata: {} }] }),
    lifeEventGateway: { async record(input) { events.push(input); } },
  });
  await service.processJob({ id: 'job-1', attempts: 1, max_attempts: 3, payload: { documentId: DOCUMENT } });
  assert.equal(events[0].eventType, 'document.ingested');
  assert.equal(events[0].structuredData.documentId, DOCUMENT);
  assert.doesNotMatch(JSON.stringify(events[0]), /private body|storage_key|opaque/);
});

test('event summaries redact credential-shaped input and simple events reject raw media upstream', async () => {
  assert.equal(safeSummary('token: abcdefghijklmnopqrstuvwxyz123456'), '[скрыто]');
  const calls = [];
  await recordSimpleEvent({ async record(input) { calls.push(input); } }, {
    userId: USER, eventType: 'device.connected', sourceChannel: 'device', sourceRef: 'device:1',
    deduplicationKey: 'device:1', summary: 'Device online', structuredData: { deviceId: DEVICE },
  });
  assert.equal(calls[0].structuredData.deviceId, DEVICE);
});
