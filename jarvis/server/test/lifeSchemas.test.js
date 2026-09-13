const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProjectSchema,
  lifeEventInputSchema,
  lifeEventLinkInputSchema,
  parseLifeEventInput,
  timelineQuerySchema,
  updateProjectSchema,
} = require('../src/life/lifeSchemas');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

function event(overrides = {}) {
  return {
    userId: USER_ID,
    eventType: 'message.received',
    occurredAt: '2026-09-12T12:00:00.000Z',
    sourceChannel: 'telegram',
    sourceRef: 'update:42',
    deduplicationKey: 'telegram:update:42:message.received',
    summary: 'Пользователь сообщил о продолжении проекта.',
    structuredData: { conversationId: EVENT_ID },
    ...overrides,
  };
}

test('accepts a bounded cross-source Life event and normalizes its timestamp', () => {
  const parsed = parseLifeEventInput(event());
  assert.equal(parsed.eventType, 'message.received');
  assert.ok(parsed.occurredAt instanceof Date);
  assert.equal(parsed.confidence, 1);
  assert.equal(parsed.privacyClass, 'personal');
});

test('rejects unknown event fields, types, invalid confidence, and oversized summaries', () => {
  assert.throws(() => lifeEventInputSchema.parse(event({ unexpected: true })));
  assert.throws(() => lifeEventInputSchema.parse(event({ eventType: 'shell.executed' })));
  assert.throws(() => lifeEventInputSchema.parse(event({ confidence: 1.1 })));
  assert.throws(() => lifeEventInputSchema.parse(event({ summary: 'x'.repeat(1001) })));
});

test('rejects structured data over the persisted byte boundary', () => {
  assert.throws(() => lifeEventInputSchema.parse(event({ structuredData: { text: 'я'.repeat(9000) } })));
});

test('rejects binary and sensitive raw payload fields from Event Spine', () => {
  assert.throws(() => lifeEventInputSchema.parse(event({ structuredData: { audioBytes: 'base64' } })));
  assert.throws(() => lifeEventInputSchema.parse(event({ structuredData: { nested: { apiToken: 'secret' } } })));
  assert.throws(() => lifeEventInputSchema.parse(event({ structuredData: { payload: Buffer.from('raw') } })));
  assert.doesNotThrow(() => lifeEventInputSchema.parse(event({ structuredData: { conversationId: EVENT_ID, messageKind: 'text' } })));
});

test('requires owner-scoped typed links with allowlisted relation names', () => {
  const parsed = lifeEventLinkInputSchema.parse({
    userId: USER_ID,
    eventId: EVENT_ID,
    targetType: 'project',
    targetId: USER_ID,
    relationType: 'project.context',
    origin: 'inferred',
    confidence: 0.82,
  });
  assert.equal(parsed.targetType, 'project');
  assert.throws(() => lifeEventLinkInputSchema.parse({ ...parsed, relationType: 'DROP TABLE' }));
});

test('bounds project and Timeline request schemas', () => {
  assert.equal(createProjectSchema.parse({ name: 'Life OS' }).summary, '');
  assert.throws(() => createProjectSchema.parse({ name: '' }));
  assert.throws(() => updateProjectSchema.parse({ revision: 1 }));
  assert.equal(timelineQuerySchema.parse({ limit: '100' }).limit, 100);
  assert.throws(() => timelineQuerySchema.parse({ limit: 101 }));
  assert.throws(() => timelineQuerySchema.parse({ cursor: 'x'.repeat(513) }));
});
