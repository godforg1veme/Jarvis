const assert = require('node:assert/strict');
const test = require('node:test');
const { TelegramLifeOsService, isLifeCallback } = require('../src/telegram/telegramLifeOsService');
const { telegramReplyMarkup } = require('../src/telegram/bot');

const USER = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const OBJECT = '33333333-3333-4333-8333-333333333333';

function harness() {
  const calls = []; let active = null;
  const project = { id: OBJECT, name: 'Life OS', summary: 'Контекстный Jarvis', status: 'active', revision: 1 };
  const service = new TelegramLifeOsService({
    interactions: {
      async begin(input) { active = { id: '44444444-4444-4444-8444-444444444444', ...input }; return active; },
      async getActive() { return { interaction: active, expired: false }; },
      async consume({ id }) { if (!active || active.id !== id) return null; const consumed = active; active = null; return consumed; },
    },
    missionControlService: {
      async get() { return { currentMission: { ...project, priorityRevision: 1, reasons: [{ code: 'deadline', value: 1 }] }, rankedProjects: [{ ...project, priorityRevision: 1 }], commitments: [{}], proposals: [{}], mode: { mode: 'focus' }, nextStep: { title: 'Продолжить' } }; },
      async pin(input) { calls.push(['pin', input]); return {}; }, async replace(input) { calls.push(['replace', input]); return {}; }, async hide(input) { calls.push(['hide', input]); return {}; }, async restore() { return {}; },
    },
    timelineService: { async list() { return { items: [{ id: OBJECT, type: 'project.updated', summary: 'Проект обновлён', status: 'trusted' }] }; } },
    repository: {
      async listProjects() { return [project]; }, async getProject() { return project; },
      async listCommitments() { return [{ id: OBJECT, title: 'Продолжить проект', status: 'open', revision: 1 }]; },
      async getCommitment() { return { id: OBJECT, title: 'Продолжить проект', status: 'open', revision: 1 }; },
      async updateCommitment(input) { calls.push(['commitment', input]); return {}; },
      async recordFeedback(input) { calls.push(['feedback', input]); return {}; },
      async listProposals() { return [{ id: OBJECT, title: 'Подготовить проект', status: 'open' }]; },
      async getProposal() { return { id: OBJECT, title: 'Подготовить проект', status: 'open' }; },
    },
    reminderRepository: { async list() { return [{ id: OBJECT, title: 'Напоминание', state: 'scheduled', revision: 1 }]; }, async get() { return { id: OBJECT, title: 'Напоминание', state: 'scheduled', revision: 1 }; } },
    reminderService: { async cancel() { return {}; }, async acknowledge() { return {}; }, async reschedule() { return {}; }, async create() { return {}; } },
    peopleService: {
      async list() { return [{ id: OBJECT, display_name: 'Максим', relationship_type: 'owner', status: 'active', revision: 1 }]; },
      async create() { return {}; }, async update() { return {}; }, async createRelationship() { return {}; }, async createProjectLink() { return {}; },
    },
    familyAccessService: { async listOwned() { return []; }, async create(input) { calls.push(['grant', input]); return {}; }, async revoke() { return {}; } },
    modeService: { async get() { return { mode: 'focus', revision: 1 }; }, async setManual(input) { calls.push(['mode', input]); return {}; } },
    preferenceService: { async list() { return [{ key: 'response.style', value: 'balanced', revision: 1 }]; }, async set() { return {}; }, async reset() { return {}; }, async remove() { return {}; } },
    sourceRepository: { async list() { return [{ id: OBJECT, display_name: 'Календарь', adapter_type: 'calendar', enabled: false, revision: 1 }]; }, async get() { return { id: OBJECT, display_name: 'Календарь', adapter_type: 'calendar', enabled: false, revision: 1 }; }, async update() { return {}; }, async create() { return {}; } },
    sourceSyncService: { async sync() { return { status: 'complete', accepted: 1 }; } },
    projectService: { async create() { return {}; }, async update() { return {}; } },
    recoveryPlanService: { async createPreview() { return { id: OBJECT, revision: 1, summary: 'Восстановить Life OS', steps: [{ label: 'Открыть проект' }] }; }, async propose() { return { proposalId: OBJECT }; } },
  });
  return { service, calls, context: { user: { id: USER, role: 'owner' }, conversation: { id: CONVERSATION }, chatId: '101' }, getActive: () => active };
}

function buttons(result) { return (result.buttons || []).flat(); }

test('Life OS home exposes every implemented section with valid bounded callbacks', async () => {
  const { service, context } = harness(); const home = await service.home(context);
  const callbacks = buttons(home).map((button) => button.data);
  assert.deepEqual(callbacks, ['life:m', 'life:t', 'life:p', 'life:c', 'life:o', 'life:r', 'life:h', 'life:d', 'life:f', 'life:s', 'life:x']);
  for (const data of callbacks) {
    assert.equal(isLifeCallback(data), true);
    assert.ok(Buffer.byteLength(data, 'utf8') <= 64);
    const result = await service.handleCallback(data, context);
    assert.ok(result?.answer);
    telegramReplyMarkup(result.buttons);
  }
});

test('every emitted Life callback is accepted and has a real handler or legacy proposal route', async () => {
  const { service, context } = harness();
  const queue = (await service.home(context)).buttons.flat().map((button) => button.data);
  const seen = new Set();
  while (queue.length) {
    const data = queue.shift();
    if (seen.has(data)) continue;
    seen.add(data);
    assert.equal(isLifeCallback(data) || data.startsWith('flow:cancel:'), true, data);
    if (!isLifeCallback(data) || /^life:(?:confirm|dismiss):/.test(data)) continue;
    const result = await service.handleCallback(data, context);
    assert.ok(result?.answer, data);
    telegramReplyMarkup(result.buttons);
    for (const button of buttons(result)) {
      assert.equal(isLifeCallback(button.data) || button.data.startsWith('flow:cancel:'), true, button.data);
      if (!seen.has(button.data)) queue.push(button.data);
    }
  }
  for (const expected of ['life:p:v:', 'life:p:edit:', 'life:r:cancel:', 'life:h:grant', 'life:f:reset:', 'life:s:sync:', 'life:x:recover:']) {
    assert.equal([...seen].some((value) => value.startsWith(expected)), true, expected);
  }
});

test('mutations remain owner-scoped, revision-aware, and recovery creates a proposal before execution', async () => {
  const { service, context, calls } = harness();
  assert.match((await service.handleCallback(`life:c:done:${OBJECT}:1`, context)).answer, /обновлён/);
  assert.equal(calls[0][1].userId, USER);
  assert.equal(calls[0][1].revision, 1);
  const preview = await service.handleCallback(`life:x:recover:${OBJECT}:1`, context);
  assert.equal(buttons(preview)[0].data, `life:x:propose:${OBJECT}:1`);
  const proposal = await service.handleCallback(buttons(preview)[0].data, context);
  assert.equal(buttons(proposal)[0].data, `life:confirm:${OBJECT}`);
});

test('guided Life input uses closed flow kinds and excludes values from callback data', async () => {
  const { service, context, getActive } = harness();
  const prompt = await service.handleCallback('life:p:new', context);
  assert.match(prompt.answer, /название/);
  assert.equal(getActive().kind, 'life_project_create');
  assert.equal(JSON.stringify(prompt.buttons).includes('Life OS secret'), false);
});

test('editing and relationship controls use revision-bound guided flows', async () => {
  const { service, context, getActive } = harness();
  await service.handleCallback(`life:p:edit:${OBJECT}:1`, context);
  assert.deepEqual(getActive().context, { targetId: OBJECT, revision: 1 });
  assert.equal(getActive().kind, 'life_project_update');
  await service.handleCallback('life:h:rel', context);
  assert.equal(getActive().kind, 'life_relationship_create');
  await service.handleCallback('life:h:link', context);
  assert.equal(getActive().kind, 'life_project_link_create');
});

test('family sharing requires a second explicit owner-bound confirmation', async () => {
  const { service, context, calls, getActive } = harness();
  await service.handleCallback('life:h:grant', context);
  const prompt = await service.handlePendingText(`${USER} | project | ${OBJECT} | view_summary`, context, getActive());
  const confirmation = getActive();
  assert.equal(confirmation.kind, 'life_family_grant_confirm');
  assert.equal(buttons(prompt)[0].data, `life:h:apply:${confirmation.id}`);
  assert.equal(isLifeCallback(buttons(prompt)[0].data), true);
  assert.match((await service.handleCallback(buttons(prompt)[0].data, context)).answer, /обновлён/);
  assert.equal(calls.find(([name]) => name === 'grant')[1].userId, USER);
  assert.equal((await service.handleCallback(buttons(prompt)[0].data, context)).answer, 'Подтверждение уже недоступно.');
});

test('invalid and oversized Life callbacks are rejected', () => {
  assert.equal(isLifeCallback('life:unknown'), false);
  assert.equal(isLifeCallback(`life:p:v:${'a'.repeat(80)}`), false);
  assert.equal(isLifeCallback('life:d:mode:admin:1'), false);
});
