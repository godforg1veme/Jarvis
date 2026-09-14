const test = require('node:test');
const assert = require('node:assert/strict');
const { LifeContextComposer } = require('../src/life/context/lifeContextComposer');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

function harness(overrides = {}) {
  const calls = [];
  const repository = {
    async listProjects(input) { calls.push(['projects', input]); return [{ id: PROJECT_ID, area_id: null, name: 'Life OS', summary: 'Контекстный Jarvis', status: 'active', updated_at: '2026-09-14T10:00:00.000Z' }]; },
    async listCommitments(input) { calls.push(['commitments', input]); return [{ title: 'Продолжить Life OS', project_id: PROJECT_ID, project_name: 'Life OS', due_at: '2026-09-15T15:00:00.000Z', confidence: 0.95 }]; },
    async listProposals(input) { calls.push(['proposals', input]); return []; },
    async listTimeline(input) { calls.push(['timeline', input]); return [{ event_type: 'message.received', summary: 'Продолжить Life OS завтра вечером', occurred_at: '2026-09-14T10:00:00.000Z', confidence: 1, trust_level: 'user', privacy_class: 'personal', links: [] }]; },
    async listProjectDocuments(input) { calls.push(['documents', input]); return []; },
  };
  return {
    calls,
    composer: new LifeContextComposer({
      repository,
      priorityRepository: { async list(input) { calls.push(['priority', input]); return [{ project_id: PROJECT_ID, pinned: true, calculated_score: 80, confidence: 0.9 }]; } },
      modeRepository: { async get(input) { calls.push(['mode', input]); return { mode: 'work' }; } },
      preferenceRepository: { async list(input) { calls.push(['preferences', input]); return [{ preference_key: 'initiative.level', value: 'high', source: 'explicit' }]; } },
      deviceRepository: { async listForUser(userId) { calls.push(['devices', { userId }]); return [{ id: 'do-not-pass', name: 'Desktop', status: 'online', capabilities: { shell: true } }]; } },
      enabled: true,
      now: () => new Date('2026-09-14T12:00:00.000Z'),
      ...overrides,
    }),
  };
}

test('composer builds bounded owner-scoped context from limited queries', async () => {
  const { composer, calls } = harness();
  const result = await composer.compose({
    userId: USER_ID, channel: 'desktop', conversationId: PROJECT_ID,
    deviceId: PROJECT_ID, text: 'Как продолжить Life OS?', locale: 'ru-RU',
  });
  assert.equal(result.status, 'fresh');
  assert.equal(result.lifeContext.currentProject.name, 'Life OS');
  assert.equal(result.lifeContext.items.some((item) => item.title === 'Продолжить Life OS'), true);
  assert.equal(JSON.stringify(result).includes('do-not-pass'), false);
  assert.equal(JSON.stringify(result).includes('shell'), false);
  assert.equal(result.communicationGuidance.initiative, 'high');
  for (const [, input] of calls.filter(([name]) => name !== 'devices')) assert.equal(input.userId, USER_ID);
  assert.equal(calls.find(([name]) => name === 'timeline')[1].limit, 25);
});

test('composer degrades without throwing when projections fail or feature is disabled', async () => {
  const disabled = harness({ enabled: false }).composer;
  assert.deepEqual(await disabled.compose({ userId: USER_ID, text: 'Привет' }), {
    status: 'disabled', lifeContext: null, communicationGuidance: null,
  });
  const unavailable = harness({ repository: { async listProjects() { throw new Error('private database detail'); } } }).composer;
  assert.deepEqual(await unavailable.compose({ userId: USER_ID, text: 'Привет' }), {
    status: 'unavailable', lifeContext: null, communicationGuidance: null,
  });
});

test('composer does not return unrelated Timeline text for an ordinary factual request', async () => {
  const { composer } = harness();
  const result = await composer.compose({ userId: USER_ID, text: 'Какова скорость света?', channel: 'telegram' });
  assert.equal(result.lifeContext.items.some((item) => item.summary?.includes('завтра вечером')), false);
});

test('composer includes safe people and explicitly granted family summaries only when relevant', async () => {
  let sharedInput = null;
  const { composer } = harness({
    peopleRepository: {
      async listPeople() { return [{ id: 'person-a', display_name: 'Анна', relationship_type: 'family', updated_at: '2026-09-14T10:00:00.000Z' }]; },
      async listProjectLinks() { return [{ person_id: 'person-a', project_id: PROJECT_ID, role: 'stakeholder' }]; },
    },
    familyAccessService: {
      async listShared(input) { sharedInput = input; return [{ grantId: 'private-grant', resourceType: 'project', permission: 'view_summary', label: 'Семейный проект', summary: 'Общий план' }]; },
    },
  });
  const result = await composer.compose({ userId: USER_ID, text: 'Анна, семейный проект', channel: 'desktop' });
  assert.equal(result.lifeContext.items.some((item) => item.title === 'Анна'), true);
  assert.equal(result.lifeContext.items.some((item) => item.title === 'Семейный проект'), true);
  assert.equal(JSON.stringify(result).includes('private-grant'), false);
  assert.deepEqual(sharedInput, { memberUserId: USER_ID });
});
