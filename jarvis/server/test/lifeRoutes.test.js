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
      async recordFeedback() { return null; }, async updateCommitment() { return null; },
    },
    projectService: {
      async bootstrap({ userId }) { calls.push(userId); return { areas: [], projects: [] }; },
      async create({ userId, input }) { calls.push(userId); return { id: PROJECT, area_id: null, ...input, status: 'active', revision: 1, created_at: new Date(), updated_at: new Date() }; },
      async update() { return null; },
    },
    timelineService: { async list({ userId }) { calls.push(userId); return { items: [], nextCursor: null }; } },
    contextService: { async recover() { return null; } },
    missionControlService: { async get({ userId }) { calls.push(userId); return { projects: [] }; } },
    proposalService: { async confirm() { return null; }, async dismiss() { return null; } },
    gateway: { async record() {} },
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
