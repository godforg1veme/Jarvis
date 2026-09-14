const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config/loadConfig');
const { FixedWindowRateLimiter } = require('../src/http/rateLimiter');
const { registerLifeRoutes } = require('../src/life/lifeRoutes');

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const app = buildApp({ config: loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' }) });
  const calls = [];
  registerLifeRoutes(app, {
    authenticate: async (headers) => {
      if (headers.authorization !== 'Bearer valid') { const error = new Error(); error.statusCode = 401; error.publicCode = 'DEVICE_AUTH_REQUIRED'; throw error; }
      return { id: DEVICE, user_id: USER };
    },
    limiter: new FixedWindowRateLimiter(),
    repository: {
      async listProjects({ userId }) { calls.push(userId); return []; },
      async recordFeedback({ userId, ...input }) { calls.push(userId); return { id: DEVICE, ...input, target_id: input.targetId }; },
      async updateCommitment() { return null; },
    },
    projectService: {
      async bootstrap({ userId }) { calls.push(userId); return { areas: [], projects: [] }; },
      async create({ userId, input }) { calls.push(userId); return { id: PROJECT, area_id: null, ...input, status: 'active', revision: 1, created_at: new Date(), updated_at: new Date() }; },
      async update() { return null; },
    },
    timelineService: { async list({ userId }) { calls.push(userId); return { items: [], nextCursor: null }; } },
    contextService: { async recover() { return null; } },
    missionControlService: {
      async get({ userId }) { calls.push(userId); return { projects: [] }; },
      async pin({ userId, projectId }) { calls.push(userId); return { project_id: projectId, pinned: true, hidden_until: null, user_weight: 0, revision: 1 }; },
      async replace() { return null; }, async hide() { return null; }, async restore() { return null; },
    },
    proposalService: { async confirm() { return null; }, async dismiss() { return null; } },
    gateway: { async record() {} },
    modeService: {
      async get({ userId }) { calls.push(userId); return { mode: 'work', source: 'default', revision: null, policy: { notificationPolicy: 'normal', proposalVisibility: 'all', missionEmphasis: 'work', responseLength: 'balanced', initiative: 'normal', interruptionPolicy: 'normal' } }; },
      async setManual({ userId, input }) { calls.push(userId); return { ...input, source: 'manual', revision: 1, policy: { notificationPolicy: 'defer_non_urgent', proposalVisibility: 'urgent_and_current', missionEmphasis: 'current_project', responseLength: 'concise', initiative: 'minimal', interruptionPolicy: 'focus' } }; },
      async acceptSuggestion() { return null; },
    },
    preferenceService: {
      async list({ userId }) { calls.push(userId); return [{ key: 'response.style', value: 'balanced', source: 'default', confidence: 1 }]; },
      async set({ userId, key, value }) { calls.push(userId); return { key, value, source: 'explicit', revision: 1, confidence: 1 }; },
      async reset() { return null; }, async remove() { return null; },
    },
    feedbackAggregator: { async aggregate({ userId }) { calls.push(userId); return { updated: false }; } },
    peopleService: {
      async list({ userId }) { calls.push(userId); return []; },
      async create({ userId, input }) { calls.push(userId); return { id: DEVICE, display_name: input.displayName, aliases: input.aliases, relationship_type: input.relationshipType, status: 'active', revision: 1, created_at: new Date(), updated_at: new Date() }; },
      async update() { return null; }, async listRelationships() { return []; },
      async createRelationship() { return null; }, async listProjectLinks() { return []; },
      async createProjectLink() { return null; },
    },
    familyAccessService: {
      async listOwned({ userId }) { calls.push(userId); return []; },
      async create({ userId, input }) { calls.push(userId); return { id: DEVICE, member_user_id: input.memberUserId, resource_type: input.resourceType, resource_id: input.resourceId, permission: input.permission, starts_at: new Date(), revision: 1 }; },
      async revoke() { return null; },
      async listShared({ memberUserId }) { calls.push(memberUserId); return [{ grantId: 'safe', resourceType: 'project', permission: 'view_summary', label: 'Life OS', summary: 'Семейный проект', expiresAt: null }]; },
    },
  });
  return { app, calls };
}

test('Life API requires device auth and derives owner scope from it', async () => {
  const { app, calls } = fixture();
  assert.equal((await app.inject({ method: 'GET', url: '/v1/desktop/life/mission-control' })).statusCode, 401);
  const response = await app.inject({ method: 'GET', url: '/v1/desktop/life/mission-control', headers: { authorization: 'Bearer valid' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [USER]);
  await app.close();
});

test('project writes use strict schemas and return no owner identifiers', async () => {
  const { app } = fixture();
  const invalid = await app.inject({ method: 'POST', url: '/v1/desktop/life/projects', headers: { authorization: 'Bearer valid' }, payload: { name: 'Life OS', injected: true } });
  assert.equal(invalid.statusCode, 400);
  const response = await app.inject({ method: 'POST', url: '/v1/desktop/life/projects', headers: { authorization: 'Bearer valid' }, payload: { name: 'Life OS' } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().project.name, 'Life OS');
  assert.equal(Object.hasOwn(response.json().project, 'user_id'), false);
  await app.close();
});

test('cross-owner project context is indistinguishable from missing', async () => {
  const { app } = fixture();
  const response = await app.inject({ method: 'GET', url: `/v1/desktop/life/projects/${PROJECT}/context`, headers: { authorization: 'Bearer valid' } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, 'LIFE_SCOPE_NOT_FOUND');
  await app.close();
});

test('mode and preference APIs derive owner scope and expose no authority controls', async () => {
  const { app, calls } = fixture();
  const headers = { authorization: 'Bearer valid' };
  const mode = await app.inject({ method: 'PUT', url: '/v1/desktop/life/mode', headers, payload: { mode: 'focus' } });
  assert.equal(mode.statusCode, 200);
  assert.equal(mode.json().mode.mode, 'focus');
  assert.equal(Object.hasOwn(mode.json().mode.policy, 'bypassesConfirmation'), false);
  const preference = await app.inject({
    method: 'PUT', url: '/v1/desktop/life/preferences/response.style', headers,
    payload: { value: 'concise' },
  });
  assert.equal(preference.statusCode, 200);
  assert.equal(preference.json().preference.value, 'concise');
  assert.equal(calls.filter((value) => value === USER).length, 2);
  const injected = await app.inject({
    method: 'PUT', url: '/v1/desktop/life/preferences/response.style', headers,
    payload: { value: 'concise', authority: 'admin' },
  });
  assert.equal(injected.statusCode, 400);
  await app.close();
});

test('proposal feedback is owner-scoped and triggers bounded preference aggregation', async () => {
  const { app, calls } = fixture();
  const response = await app.inject({
    method: 'POST', url: `/v1/desktop/life/proposals/${PROJECT}/feedback`,
    headers: { authorization: 'Bearer valid' }, payload: { kind: 'not_useful', note: 'Не вовремя' },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().feedback.kind, 'not_useful');
  assert.deepEqual(calls.slice(-2), [USER, USER]);
  await app.close();
});

test('people and family routes expose only authenticated owner-scoped records', async () => {
  const { app, calls } = fixture();
  const headers = { authorization: 'Bearer valid' };
  const person = await app.inject({
    method: 'POST', url: '/v1/desktop/life/people', headers,
    payload: { displayName: 'Анна', aliases: ['Аня'], relationshipType: 'family', notes: 'private note' },
  });
  assert.equal(person.statusCode, 201);
  assert.equal(person.json().person.displayName, 'Анна');
  assert.equal(Object.hasOwn(person.json().person, 'notes'), false);
  const grant = await app.inject({
    method: 'POST', url: '/v1/desktop/life/family-grants', headers,
    payload: { memberUserId: DEVICE, resourceType: 'project', resourceId: PROJECT, permission: 'view_summary' },
  });
  assert.equal(grant.statusCode, 201);
  assert.equal(Object.hasOwn(grant.json().grant, 'userId'), false);
  const shared = await app.inject({ method: 'GET', url: '/v1/desktop/life/family/shared', headers });
  assert.equal(shared.statusCode, 200);
  assert.equal(shared.json().shared[0].label, 'Life OS');
  assert.deepEqual(calls.slice(-3), [USER, USER, USER]);
  await app.close();
});

test('mission pin derives project owner from device authentication', async () => {
  const { app, calls } = fixture();
  const response = await app.inject({
    method: 'POST', url: `/v1/desktop/life/missions/${PROJECT}/pin`,
    headers: { authorization: 'Bearer valid' }, payload: {},
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().priority.projectId, PROJECT);
  assert.equal(response.json().priority.pinned, true);
  assert.deepEqual(calls, [USER]);
  await app.close();
});
