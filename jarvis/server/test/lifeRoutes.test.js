const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config/loadConfig');
const { FixedWindowRateLimiter } = require('../src/http/rateLimiter');
const { registerLifeRoutes } = require('../src/life/lifeRoutes');

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const REMINDER = '44444444-4444-4444-8444-444444444444';
const PLAN = '55555555-5555-4555-8555-555555555555';

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
    reminderRepository: { async list({ userId }) { calls.push(userId); return []; } },
    reminderService: {
      async create({ userId, origin, input }) {
        calls.push(userId);
        return {
          id: REMINDER, title: input.title, trigger_at: input.triggerAt, timezone: input.timezone,
          recurrence: null, delivery_channels: input.deliveryChannels, origin_channel: origin.channel,
          state: 'scheduled', revision: 1, created_at: new Date(), updated_at: new Date(),
        };
      },
      async reschedule() { return null; }, async cancel() { return null; }, async acknowledge() { return null; },
    },
    recoveryPlanService: {
      async createPreview(input) { calls.push(input.userId); return { id: PLAN, projectId: input.projectId, status: 'ready', revision: 1, steps: [] }; },
      async get({ userId }) { calls.push(userId); return { id: PLAN, projectId: PROJECT, status: 'ready', revision: 1, steps: [] }; },
      async propose({ userId }) { calls.push(userId); return { plan: { id: PLAN, projectId: PROJECT, status: 'awaiting_confirmation', revision: 2, steps: [] }, proposalId: REMINDER }; },
    },
    sourceRepository: {
      async list({ userId }) { calls.push(userId); return []; },
      async create({ userId, ...input }) { calls.push(userId); return { id: PLAN, adapter_type: input.adapterType, display_name: input.displayName, enabled: input.enabled, selected_scope: input.selectedScope, privacy_policy_version: input.privacyPolicyVersion, configuration_metadata: input.configurationMetadata, health_status: 'unconfigured', revision: 1 }; },
      async update() { return null; },
    },
    sourceSyncService: { async sync({ userId }) { calls.push(userId); return { status: 'fixture_disabled', accepted: 0 }; } },
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

test('reminder API derives Desktop destination from auth and rejects injected origin fields', async () => {
  const { app, calls } = fixture();
  const headers = { authorization: 'Bearer valid' };
  const payload = {
    requestId: '55555555-5555-4555-8555-555555555555', title: 'Продолжить Life OS',
    triggerAt: '2026-09-15T15:00:00Z', timezone: 'Europe/Moscow', deliveryChannels: ['desktop'],
  };
  const response = await app.inject({ method: 'POST', url: '/v1/desktop/life/reminders', headers, payload });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().reminder.origin, 'desktop');
  assert.equal(Object.hasOwn(response.json().reminder, 'originDeviceId'), false);
  assert.equal(calls.at(-1), USER);
  const injected = await app.inject({
    method: 'POST', url: '/v1/desktop/life/reminders', headers,
    payload: { ...payload, requestId: '66666666-6666-4666-8666-666666666666', originDeviceId: 'attacker' },
  });
  assert.equal(injected.statusCode, 400);
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

test('recovery routes derive owner and Desktop origin while rejecting injected action data', async () => {
  const { app, calls } = fixture();
  const headers = { authorization: 'Bearer valid' };
  const created = await app.inject({ method: 'POST', url: `/v1/desktop/life/projects/${PROJECT}/recovery-plans`, headers, payload: { sourceContextRevision: 1 } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().plan.status, 'ready');
  const injected = await app.inject({ method: 'POST', url: `/v1/desktop/life/projects/${PROJECT}/recovery-plans`, headers,
    payload: { sourceContextRevision: 1, actionArguments: { shell: 'whoami' } } });
  assert.equal(injected.statusCode, 400);
  const proposed = await app.inject({ method: 'POST', url: `/v1/desktop/life/recovery-plans/${PLAN}/propose`, headers, payload: { revision: 1 } });
  assert.equal(proposed.statusCode, 200);
  assert.equal(proposed.json().proposalId, REMINDER);
  assert.deepEqual(calls.slice(-2), [USER, USER]);
  await app.close();
});

test('source routes expose fixture status and reject credential-shaped configuration', async () => {
  const { app, calls } = fixture(); const headers = { authorization: 'Bearer valid' };
  const created = await app.inject({ method: 'POST', url: '/v1/desktop/life/sources', headers,
    payload: { adapterType: 'calendar', displayName: 'Calendar fixture', enabled: false, selectedScope: {}, configurationMetadata: {} } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().source.transport, 'fixture_only');
  const secret = await app.inject({ method: 'POST', url: '/v1/desktop/life/sources', headers,
    payload: { adapterType: 'email', displayName: 'bad', configurationMetadata: { accessToken: 'x' } } });
  assert.equal(secret.statusCode, 400);
  const sync = await app.inject({ method: 'POST', url: `/v1/desktop/life/sources/${PLAN}/sync`, headers, payload: {} });
  assert.equal(sync.json().result.status, 'fixture_disabled');
  assert.deepEqual(calls.slice(-2), [USER, USER]);
  await app.close();
});
