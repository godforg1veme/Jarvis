const test = require('node:test');
const assert = require('node:assert/strict');
const { LifeEventRepository } = require('../src/life/lifeEventRepository');
const { LifeProjectionRepository } = require('../src/life/lifeProjectionRepository');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_ID = '44444444-4444-4444-8444-444444444444';

function event(overrides = {}) {
  return {
    userId: USER_ID,
    eventType: 'message.received',
    occurredAt: '2026-09-12T10:00:00.000Z',
    sourceChannel: 'telegram',
    sourceRef: 'update:7',
    deduplicationKey: 'telegram:update:7:message.received',
    summary: 'Пользователь вернётся к проекту.',
    structuredData: { conversationId: EVENT_ID },
    ...overrides,
  };
}

test('event creation is parameterized, bounded, and owner-deduplicated', async () => {
  const calls = [];
  const repository = new LifeEventRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: EVENT_ID, user_id: USER_ID, inserted: true }] };
    },
  });
  const created = await repository.create(event());
  assert.equal(created.inserted, true);
  assert.match(calls[0].sql, /ON CONFLICT \(user_id, deduplication_key\)/);
  assert.match(calls[0].sql, /\$9::jsonb/);
  assert.equal(calls[0].params[0], USER_ID);
  assert.equal(calls[0].params[6], 'telegram:update:7:message.received');
  assert.equal(calls[0].sql.includes(USER_ID), false);
});

test('event reads and lifecycle updates bind event, owner, and claim token', async () => {
  const calls = [];
  const repository = new LifeEventRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; },
  });
  await repository.getForUser({ userId: USER_ID, eventId: EVENT_ID });
  await repository.markProcessed({ userId: USER_ID, eventId: EVENT_ID, claimToken: DEVICE_ID });
  await repository.markFailed({ userId: USER_ID, eventId: EVENT_ID, claimToken: DEVICE_ID, errorCode: 'PROVIDER_TIMEOUT' });
  assert.deepEqual(calls[0].params, [EVENT_ID, USER_ID]);
  assert.match(calls[1].sql, /id = \$1 AND user_id = \$2.*claim_token = \$3/s);
  assert.deepEqual(calls[1].params, [EVENT_ID, USER_ID, DEVICE_ID]);
  assert.deepEqual(calls[2].params, [EVENT_ID, USER_ID, DEVICE_ID, 'PROVIDER_TIMEOUT']);
  await assert.rejects(
    repository.markFailed({ userId: USER_ID, eventId: EVENT_ID, claimToken: DEVICE_ID, errorCode: 'secret text' }),
    /invalid Life OS processing error code/,
  );
});

test('worker claims use skip-locked atomic updates and optional owner scope', async () => {
  const calls = [];
  const repository = new LifeEventRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: EVENT_ID, user_id: USER_ID }] }; },
  });
  const claimed = await repository.claimPending({ userId: USER_ID, limit: 500 });
  assert.match(claimed.claimToken, /^[0-9a-f-]{36}$/);
  assert.equal(claimed.events.length, 1);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /user_id = \$2::uuid/);
  assert.equal(calls[0].params[1], USER_ID);
  assert.equal(calls[0].params[2], 100);
});

test('default areas and project operations always pass owner separately', async () => {
  const calls = [];
  const repository = new LifeProjectionRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; },
  });
  await repository.ensureDefaultAreas({ userId: USER_ID });
  await repository.createProject({ userId: USER_ID, areaId: EVENT_ID, name: 'Life OS' });
  await repository.getProject({ userId: OTHER_USER_ID, projectId: PROJECT_ID });
  await repository.updateProject({
    userId: USER_ID,
    projectId: PROJECT_ID,
    revision: 2,
    areaId: EVENT_ID,
    summary: 'Единый событийный слой',
  });
  assert.equal(calls[0].params[0], USER_ID);
  assert.match(calls[1].sql, /life_areas WHERE id = \$2 AND user_id = \$1/);
  assert.deepEqual(calls[2].params, [PROJECT_ID, OTHER_USER_ID]);
  assert.match(calls[3].sql, /id = \$1 AND user_id = \$2 AND revision = \$3/);
  assert.match(calls[3].sql, /life_areas WHERE id = \$5::uuid AND user_id = \$2/);
  assert.equal(calls[3].sql.includes(USER_ID), false);
});

test('typed links select only an allowlisted target table and preserve owner checks', async () => {
  const calls = [];
  const repository = new LifeProjectionRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; },
  });
  await repository.createLink({
    userId: USER_ID,
    eventId: EVENT_ID,
    targetType: 'project',
    targetId: PROJECT_ID,
    relationType: 'project.context',
    origin: 'trusted',
    confidence: 1,
  });
  assert.match(calls[0].sql, /FROM life_projects WHERE id = \$4 AND user_id = \$1/);
  assert.deepEqual(calls[0].params.slice(0, 4), [USER_ID, EVENT_ID, 'project', PROJECT_ID]);
  await assert.rejects(repository.createLink({
    userId: USER_ID,
    eventId: EVENT_ID,
    targetType: 'anything',
    targetId: PROJECT_ID,
    relationType: 'project.context',
    origin: 'trusted',
    confidence: 1,
  }));
});

test('proposal creation rolls back when any owner-scoped evidence is missing', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).trim(), params });
      if (String(sql).includes('SELECT id FROM life_events')) return { rows: [] };
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const repository = new LifeProjectionRepository({ async connect() { return client; } });
  await assert.rejects(repository.createProposal({
    userId: USER_ID,
    title: 'Продолжить Life OS',
    explanation: 'Есть открытая договорённость.',
    riskClass: 'changing',
    actionName: 'reminder.create',
    actionArguments: { at: '2026-09-13T18:30:00.000Z' },
    originChannel: 'desktop',
    originConversationId: PROJECT_ID,
    originDeviceId: DEVICE_ID,
    cooldownKey: 'commitment:life-os:reminder',
    expiresAt: '2026-09-13T18:00:00.000Z',
    evidenceEventIds: [EVENT_ID],
  }), /evidence is unavailable/);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('feedback target existence is verified within the same owner', async () => {
  const calls = [];
  const repository = new LifeProjectionRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; },
  });
  await repository.recordFeedback({
    userId: USER_ID,
    kind: 'incorrect_link',
    targetType: 'link',
    targetId: EVENT_ID,
    note: 'Другой проект',
  });
  assert.match(calls[0].sql, /FROM life_event_links WHERE id = \$4 AND user_id = \$1/);
  assert.equal(calls[0].params[0], USER_ID);
});
