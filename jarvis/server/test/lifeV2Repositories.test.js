const test = require('node:test');
const assert = require('node:assert/strict');
const { PeopleRepository } = require('../src/life/people/peopleRepository');
const { LifeModeRepository } = require('../src/life/modes/lifeModeRepository');
const { LifePreferenceRepository } = require('../src/life/preferences/lifePreferenceRepository');
const { ReminderRepository } = require('../src/life/reminders/reminderRepository');
const { RecoveryPlanRepository } = require('../src/life/recovery/recoveryPlanRepository');
const { PriorityRepository } = require('../src/life/priority/priorityRepository');
const { SourceConnectionRepository } = require('../src/life/sources/sourceConnectionRepository');
const { EVENT_CATEGORY_IDS } = require('../src/life/people/familyAccessPolicy');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';
const DEVICE_ID = '55555555-5555-4555-8555-555555555555';

function poolWithRows(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows, rowCount: rows.length }; },
  };
}

test('people repository binds owner for records, links, and family grants', async () => {
  const pool = poolWithRows([{ id: PERSON_ID, user_id: USER_ID }]);
  const repository = new PeopleRepository(pool);
  await repository.createPerson({ userId: USER_ID, displayName: 'Анна', relationshipType: 'family' });
  await repository.listPeople({ userId: OTHER_USER_ID });
  await repository.createProjectLink({ userId: USER_ID, personId: PERSON_ID, projectId: PROJECT_ID, role: 'participant' });
  await repository.createFamilyGrant({
    userId: USER_ID, memberUserId: OTHER_USER_ID, resourceType: 'project', resourceId: PROJECT_ID, permission: 'view_summary',
  });
  assert.equal(pool.calls[0].params[0], USER_ID);
  assert.deepEqual(pool.calls[1].params, [OTHER_USER_ID, false, 100]);
  assert.match(pool.calls[2].sql, /life_people WHERE id = \$2 AND user_id = \$1/);
  assert.match(pool.calls[2].sql, /life_projects WHERE id = \$3 AND user_id = \$1/);
  assert.match(pool.calls[3].sql, /owner_user\.id = \$1 AND owner_user\.role = 'owner'/);
  assert.match(pool.calls[3].sql, /member_user\.id = \$2 AND member_user\.role = 'member'/);
  assert.match(pool.calls[3].sql, /life_projects WHERE id = \$4 AND user_id = \$1/);
  await assert.rejects(repository.createFamilyGrant({
    userId: USER_ID, memberUserId: OTHER_USER_ID, resourceType: 'event_category', resourceId: PROJECT_ID, permission: 'view_summary',
  }), /unknown family event category/);
  await repository.createFamilyGrant({
    userId: USER_ID, memberUserId: OTHER_USER_ID, resourceType: 'event_category',
    resourceId: EVENT_CATEGORY_IDS.family, permission: 'view_summary',
  });
});

test('mode and preference repositories use owner scope and optimistic revisions', async () => {
  const modePool = poolWithRows([{ id: PERSON_ID, user_id: USER_ID, revision: 3 }]);
  const modes = new LifeModeRepository(modePool);
  await modes.get({ userId: OTHER_USER_ID });
  await modes.set({ userId: USER_ID, mode: 'focus', revision: 2 });
  assert.deepEqual(modePool.calls[0].params, [OTHER_USER_ID]);
  assert.match(modePool.calls[1].sql, /life_modes\.revision = \$7/);
  assert.equal(modePool.calls[1].params[0], USER_ID);

  const preferencePool = poolWithRows([{ id: PERSON_ID }]);
  const preferences = new LifePreferenceRepository(preferencePool);
  await preferences.setExplicit({ userId: USER_ID, key: 'response.style', value: 'concise', revision: 1 });
  await preferences.remove({ userId: OTHER_USER_ID, key: 'response.style', revision: 2 });
  assert.match(preferencePool.calls[0].sql, /life_preferences\.revision = \$4/);
  assert.deepEqual(preferencePool.calls[1].params, [OTHER_USER_ID, 'response.style', 2]);
});

test('reminder repository validates owner-linked resources and claims due work atomically', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{ id: PERSON_ID, user_id: USER_ID }], rowCount: 1 };
    },
  };
  const repository = new ReminderRepository(pool);
  await repository.create({
    userId: USER_ID,
    projectId: PROJECT_ID,
    title: 'Вернуться к Life OS',
    triggerAt: '2026-09-15T15:00:00.000Z',
    timezone: 'Europe/Moscow',
    deliveryChannels: ['telegram'],
    originChannel: 'telegram',
    originConversationId: CONVERSATION_ID,
    idempotencyKey: 'life-os:tomorrow-evening',
  });
  const claim = await repository.claimDue({ now: '2026-09-15T15:00:00.000Z', limit: 10 });
  assert.match(calls[0].sql, /life_projects WHERE id = \$3 AND user_id = \$1/);
  assert.match(calls[0].sql, /conversations WHERE id = \$11 AND user_id = \$1/);
  assert.match(calls[0].params[13], /^reminder:[a-f0-9]{64}$/);
  assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[1].sql, /SET state = 'claimed', claim_token = \$1/);
  assert.equal(claim.reminders.length, 1);
  assert.match(claim.claimToken, /^[a-f0-9-]{36}$/i);
});

test('recovery plan creation is transactional and verifies owner project before steps', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).trim(), params });
      if (String(sql).includes('INSERT INTO life_recovery_plans')) return { rows: [{ id: PERSON_ID, user_id: USER_ID }] };
      if (String(sql).includes('INSERT INTO life_recovery_steps')) return { rows: [{ id: DEVICE_ID }] };
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const repository = new RecoveryPlanRepository({ async connect() { return client; } });
  const result = await repository.create({
    userId: USER_ID,
    projectId: PROJECT_ID,
    sourceContextRevision: 1,
    summary: 'Подготовить Life OS',
    creationReason: 'user.request',
    originChannel: 'desktop',
    originDeviceId: DEVICE_ID,
    idempotencyKey: 'recovery:life-os:1',
    expiresAt: '2026-09-15T12:00:00.000Z',
    steps: [{ position: 0, stepType: 'prepare_workspace', label: 'Подготовить проект', riskClass: 'changing', actionName: 'workspace.prepare', resourceRef: PROJECT_ID }],
  });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /life_projects WHERE id = \$2 AND user_id = \$1/);
  assert.match(calls[2].sql, /INSERT INTO life_recovery_steps/);
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
  assert.equal(result.steps.length, 1);
});

test('priority and source repositories keep owner intent separate from secret cursor state', async () => {
  const priorityPool = poolWithRows([{ project_id: PROJECT_ID }]);
  const priorities = new PriorityRepository(priorityPool);
  await priorities.setIntent({ userId: USER_ID, projectId: PROJECT_ID, revision: null, pinned: true, hiddenUntil: null, userWeight: 0.5 });
  assert.match(priorityPool.calls[0].sql, /FROM life_projects project/);
  assert.match(priorityPool.calls[0].sql, /project\.id = \$2 AND project\.user_id = \$1 AND project\.status = 'active'/);
  assert.match(priorityPool.calls[0].sql, /ON CONFLICT \(user_id, project_id\)/);

  const sourcePool = poolWithRows([{ id: PERSON_ID }]);
  const sources = new SourceConnectionRepository(sourcePool);
  await sources.create({ userId: USER_ID, adapterType: 'calendar', displayName: 'Рабочий календарь' });
  assert.doesNotMatch(sourcePool.calls[0].sql, /credential_ref|cursor_value/i);
  await sources.claimCursor({ userId: OTHER_USER_ID, connectionId: PERSON_ID, staleBefore: '2026-09-14T10:00:00.000Z' });
  assert.equal(sourcePool.calls[0].params[0], USER_ID);
  assert.match(sourcePool.calls[1].sql, /user_id = \$2 AND connection_id = \$3/);
  assert.match(sourcePool.calls[1].sql, /claim_token = \$1/);
  assert.equal(sourcePool.calls[1].params[1], OTHER_USER_ID);
  await assert.rejects(sources.ensureCursor({
    userId: USER_ID, connectionId: PERSON_ID, adapterSchemaVersion: 1, cursorValue: 'x'.repeat(2049),
  }), /cursor is invalid/);
});
