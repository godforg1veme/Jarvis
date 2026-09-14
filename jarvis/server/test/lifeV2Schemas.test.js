const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFamilyGrantSchema,
  createPersonSchema,
  createPersonProjectLinkSchema,
  createRelationshipSchema,
  updatePersonSchema,
} = require('../src/life/people/peopleSchemas');
const { setLifeModeSchema } = require('../src/life/modes/lifeModeSchemas');
const { parsePreferenceInput } = require('../src/life/preferences/lifePreferenceSchemas');
const { createReminderSchema, recurrenceSchema } = require('../src/life/reminders/reminderSchemas');
const { createRecoveryPlanSchema } = require('../src/life/recovery/recoverySchemas');
const { createSourceConnectionSchema } = require('../src/life/sources/sourceSchemas');

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

test('people and family schemas keep trust and owner fields server-controlled', () => {
  assert.equal(createPersonSchema.parse({ displayName: 'Анна', relationshipType: 'family' }).displayName, 'Анна');
  assert.throws(() => createPersonSchema.parse({ displayName: 'Анна', userId: ID }));
  assert.throws(() => createPersonSchema.parse({ displayName: 'Анна', aliases: ['a'.repeat(161)] }));
  assert.throws(() => updatePersonSchema.parse({ revision: 1 }));
  assert.doesNotThrow(() => createRelationshipSchema.parse({
    personId: ID, relationType: 'family.sister', direction: 'mutual', origin: 'user', confidence: 1,
  }));
  assert.throws(() => createRelationshipSchema.parse({
    personId: ID, relationType: 'family.sister', origin: 'trusted', confidence: 1,
  }));
  assert.doesNotThrow(() => createPersonProjectLinkSchema.parse({ personId: ID, projectId: OTHER_ID, role: 'participant' }));
  assert.doesNotThrow(() => createFamilyGrantSchema.parse({
    memberUserId: OTHER_ID, resourceType: 'project', resourceId: ID, permission: 'view_summary',
  }));
  assert.throws(() => createFamilyGrantSchema.parse({
    memberUserId: OTHER_ID, resourceType: 'device', resourceId: ID, permission: 'control',
  }));
});

test('mode and preference schemas expose only explicit closed settings', () => {
  assert.equal(setLifeModeSchema.parse({ mode: 'focus', revision: 2 }).mode, 'focus');
  assert.throws(() => setLifeModeSchema.parse({ mode: 'emergency', bypassConfirmation: true }));
  assert.deepEqual(parsePreferenceInput({ key: 'response.style', value: 'concise', revision: 1 }), {
    key: 'response.style', value: 'concise', revision: 1,
  });
  assert.throws(() => parsePreferenceInput({ key: 'response.style', value: 'execute_everything', revision: 1 }));
  assert.throws(() => parsePreferenceInput({ key: 'trusted.policy', value: true, revision: 1 }));
  assert.throws(() => parsePreferenceInput({ key: 'initiative.level', value: 'high', userId: ID }));
  assert.doesNotThrow(() => parsePreferenceInput({
    key: 'areas.priorities', value: [{ areaId: ID, weight: 0.8 }], revision: 1,
  }));
  assert.throws(() => parsePreferenceInput({
    key: 'areas.priorities', value: [{ areaId: ID, weight: 0.8 }, { areaId: ID, weight: -0.2 }], revision: 1,
  }));
});

test('reminder schemas validate recurrence, origins, and delivery bounds', () => {
  assert.equal(recurrenceSchema.parse({ kind: 'weekdays', weekdays: [1, 3, 5] }).kind, 'weekdays');
  assert.throws(() => recurrenceSchema.parse({ kind: 'weekdays', weekdays: [1, 1] }));
  assert.doesNotThrow(() => createReminderSchema.parse({
    title: 'Вернуться к Life OS',
    triggerAt: '2026-09-15T15:00:00.000Z',
    timezone: 'Europe/Moscow',
    deliveryChannels: ['telegram'],
    originChannel: 'telegram',
    originConversationId: ID,
    idempotencyKey: 'commitment:life-os:2026-09-15',
  }));
  assert.throws(() => createReminderSchema.parse({
    title: 'Run', triggerAt: '2026-09-15T15:00:00.000Z', timezone: 'UTC',
    deliveryChannels: ['email'], originChannel: 'life_os', idempotencyKey: 'x', actionArguments: { command: 'rm' },
  }));
});

test('recovery and source schemas reject paths, credentials, and arbitrary providers', () => {
  assert.doesNotThrow(() => createRecoveryPlanSchema.parse({
    projectId: ID,
    sourceContextRevision: 3,
    summary: 'Подготовить рабочий контекст',
    creationReason: 'user.request',
    originChannel: 'desktop',
    originDeviceId: OTHER_ID,
    idempotencyKey: 'recovery:life-os:3',
    expiresAt: '2026-09-15T12:00:00.000Z',
    steps: [{ position: 0, stepType: 'prepare_workspace', label: 'Подготовить проект', riskClass: 'changing', actionName: 'workspace.prepare', resourceRef: ID }],
  }));
  assert.throws(() => createRecoveryPlanSchema.parse({
    projectId: ID, sourceContextRevision: 3, summary: 'x', creationReason: 'user.request',
    originChannel: 'desktop', originDeviceId: OTHER_ID, idempotencyKey: 'r',
    expiresAt: '2026-09-15T12:00:00.000Z',
    steps: [{ position: 0, stepType: 'open_file', label: 'Open', riskClass: 'changing', actionName: 'file.open', resourceRef: 'C:\\private\\file.txt' }],
  }));
  assert.equal(createSourceConnectionSchema.parse({
    adapterType: 'calendar', displayName: 'Рабочий календарь', selectedScope: { calendarIds: ['primary'] },
  }).adapterType, 'calendar');
  assert.throws(() => createSourceConnectionSchema.parse({ adapterType: 'custom', displayName: 'Anything' }));
  assert.throws(() => createSourceConnectionSchema.parse({ adapterType: 'email', displayName: 'Mail', accessToken: 'secret' }));
});
