const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJobCallback, isJobCallback } = require('../src/jobs/jobTelegramCallbacks');
const { automaticSearchView } = require('../src/jobs/jobTelegramViews');
const { JobTelegramService } = require('../src/jobs/jobTelegramService');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const actor = { userId, telegramId: '12345', permissions: ['jobs'] };
const scope = { userId, conversationId, chatId: '12345', channel: 'telegram' };

test('autosearch callbacks carry explicit target state and bounded revision', () => {
  assert.deepEqual(parseJobCallback('job:auto_on:17'), { action: 'auto_on', revision: 17 });
  assert.deepEqual(parseJobCallback('job:auto_off:17'), { action: 'auto_off', revision: 17 });
  for (const value of ['job:auto_on:-1', 'job:auto_off:1:1', 'job:auto_on:12345678901', 'job:auto_toggle:1'])
    assert.equal(isJobCallback(value), false);
  const view = automaticSearchView({ enabled: false, available: true, revision: 17 });
  assert.equal(view.buttons[0][0].data, 'job:auto_on:17');
  assert.match(view.answer, /сама? отправляет подходящие отклики|сам отправляет подходящие отклики/);
  assert.equal(automaticSearchView({ enabled: true, revision: 18 }).buttons[0][0].data, 'job:auto_off:18');
  const stale = automaticSearchView({ enabled: true, available: false, revision: 18 });
  assert.equal(stale.buttons[0][0].data, 'job:auto_off:18');
  assert.equal(stale.buttons[1][0].data, 'job:auto_on:18');
});

test('bot toggle uses private personal scope, rejects a foreign chat and does not invert a replay', async () => {
  let enabled = false, revision = 0, mutations = 0;
  const automationService = {
    async get({ scope: actual }) { assert.deepEqual(actual, scope); return { enabled, revision, available: true }; },
    async setEnabled({ scope: actual, enabled: requested, expectedRevision }) {
      assert.deepEqual(actual, scope);
      if (expectedRevision !== revision && requested !== enabled) throw Object.assign(Error(), { code: 'JOB_REVISION_CONFLICT' });
      if (requested !== enabled) { enabled = requested; revision++; mutations++; }
      return { enabled, revision, available: true };
    },
  };
  const service = new JobTelegramService({
    pool: { async query() { return { rowCount: 1, rows: [{ id: conversationId }] }; } },
    accessService: { repository: { async get() { return { blocked: false, permissions: ['jobs'] }; } } },
    automationService,
  });
  const context = { user: { id: userId }, conversation: { id: conversationId },
    telegramUserId: '12345', chatId: '12345', chatType: 'private', access: { blocked: false, permissions: ['jobs'] } };
  assert.match((await service.handleCallback('job:auto_on:0', context)).answer, /Сейчас: включён/);
  assert.match((await service.handleCallback('job:auto_on:0', context)).answer, /Сейчас: включён/);
  assert.equal(mutations, 1);
  assert.match((await service.handleCallback('job:auto_off:1', { ...context, chatId: '99999' })).answer, /личном чате/);
  assert.equal(mutations, 1);
});

function routes({ currentActor = actor, automationService, pool } = {}) {
  const map = new Map();
  registerMiniAppSelfRoutes({
    route(method, path, handler) { map.set(`${method} ${path}`, handler); },
    async authorize() { return { actor: currentActor }; },
  }, { pool: pool || { async query(sql, params) {
    assert.match(sql, /FROM job_searches s/);
    assert.deepEqual(params, [userId, '12345']);
    return { rowCount: 1, rows: [{ id: conversationId }] };
  } }, getJobAutomationService: () => automationService });
  return { call: (method, path, body) => map.get(`${method} ${path}`)({ body }) };
}

test('Mini App derives scope from session and requires current jobs permission', async () => {
  let calls = 0;
  const service = {
    async get({ scope: actual }) { calls++; assert.deepEqual(actual, scope); return { enabled: false, revision: 0, available: true }; },
    async setEnabled({ scope: actual, enabled, expectedRevision }) {
      calls++; assert.deepEqual(actual, scope); assert.equal(enabled, true); assert.equal(expectedRevision, 0);
      return { enabled: true, revision: 1, available: true };
    },
  };
  const ok = routes({ automationService: service });
  assert.equal((await ok.call('GET', '/jobs/automation')).enabled, false);
  assert.equal((await ok.call('POST', '/jobs/automation', { enabled: true, expectedRevision: 0 })).enabled, true);
  await assert.rejects(ok.call('POST', '/jobs/automation', { enabled: true, expectedRevision: 0, userId }), { code: 'invalid_request' });
  assert.equal(calls, 2);
  const denied = routes({ currentActor: { ...actor, permissions: [] }, automationService: service });
  await assert.rejects(denied.call('GET', '/jobs/automation'), { code: 'forbidden' });
  assert.equal(calls, 2);
});

test('Mini App binds consent to the search conversation even when a newer chat conversation exists', async () => {
  const newerConversation = '33333333-3333-4333-8333-333333333333';
  const selected = routes({
    automationService: { async get({ scope: actual }) {
      assert.equal(actual.conversationId, conversationId);
      assert.notEqual(actual.conversationId, newerConversation);
      return { enabled: false, revision: 0, available: true };
    } },
    pool: { async query(sql, params) {
      assert.match(sql, /FROM job_searches s/);
      assert.deepEqual(params, [userId, '12345']);
      return { rowCount: 1, rows: [{ id: conversationId }] };
    } },
  });
  assert.equal((await selected.call('GET', '/jobs/automation')).revision, 0);
});
