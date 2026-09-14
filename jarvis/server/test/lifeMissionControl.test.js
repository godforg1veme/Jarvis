const test = require('node:test');
const assert = require('node:assert/strict');
const { MissionControlService } = require('../src/life/missionControlService');

const USER = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-14T12:00:00.000Z');

function service(overrides = {}) {
  const project = { id: PROJECT, area_id: null, name: 'Life OS', summary: 'Контекст', status: 'active', revision: 1, updated_at: NOW };
  return new MissionControlService({
    repository: {
      async ensureDefaultAreas() {}, async listAreas() { return []; }, async listProjects() { return [project]; },
      async listCommitments() { return [{ id: PROJECT, project_id: PROJECT, title: 'Продолжить', status: 'open', confidence: 1, revision: 1 }]; },
      async listProposals() { return []; }, async listTimeline() { return []; },
    },
    priorityRepository: { async list() { return []; }, async setIntent(input) { return { project_id: input.projectId, pinned: input.pinned, hidden_until: input.hiddenUntil, user_weight: input.userWeight, revision: 1 }; } },
    priorityEngine: {
      async evaluate() { return { selected: { project, score: 42, confidence: 0.8, factors: [{ code: 'activity.today', contribution: 15 }] }, ranked: [], selectionReason: 'calculated_priority', asOf: NOW.toISOString() }; },
      fallback() { return { selected: project, selectionReason: 'fallback_recent_activity' }; },
    },
    now: () => NOW,
    ...overrides,
  });
}

test('Mission Control returns an explained mission and bounded supporting state', async () => {
  const result = await service({
    deviceRepository: { async listForUser() { return [{ id: PROJECT, name: 'Desktop', status: 'online', local_path: 'C:\\private' }]; } },
    sourceRepository: { async list() { return [{ id: PROJECT, adapter_type: 'calendar', display_name: 'Calendar', enabled: true, health_status: 'healthy', cursor_value: 'private' }]; } },
  }).get({ userId: USER });
  assert.equal(result.currentMission.name, 'Life OS');
  assert.equal(result.currentMission.reasons[0].code, 'activity.today');
  assert.equal(result.nextStep.title, 'Продолжить');
  assert.equal(result.privacy.localPathsExposed, false);
  assert.doesNotMatch(JSON.stringify(result), /C:\\\\private|cursor_value|user_id/);
});

test('priority failure uses recent-activity fallback instead of database order', async () => {
  const older = { id: PROJECT, name: 'Older', status: 'active', updated_at: '2026-09-01T00:00:00.000Z' };
  const newer = { id: '33333333-3333-4333-8333-333333333333', name: 'Newer', status: 'active', updated_at: '2026-09-14T10:00:00.000Z' };
  const base = service();
  base.repository.listProjects = async () => [older, newer];
  base.priorityEngine.evaluate = async () => { throw new Error('calculation unavailable'); };
  base.priorityEngine.fallback = ({ projects, states, now }) => new (require('../src/life/priority/priorityEngine').PriorityEngine)().fallback({ projects, states, now });
  const result = await base.get({ userId: USER });
  assert.equal(result.currentMission.name, 'Newer');
  assert.equal(result.currentMission.selectionReason, 'fallback_recent_activity');
});

test('pin, hide, and restore preserve owner scope and emit explainable intent events', async () => {
  const events = [];
  let state = null;
  const instance = service({
    gateway: { async record(event) { events.push(event); } },
    priorityRepository: {
      async list() { return state ? [state] : []; },
      async setIntent(input) {
        if (state && input.revision !== state.revision) return null;
        state = { project_id: input.projectId, pinned: input.pinned, hidden_until: input.hiddenUntil, user_weight: input.userWeight, revision: (state?.revision || 0) + 1 };
        return state;
      },
    },
  });
  assert.ok(await instance.pin({ userId: USER, projectId: PROJECT }));
  assert.ok(await instance.hide({ userId: USER, projectId: PROJECT, revision: 1, hiddenUntil: '2026-09-15T12:00:00.000Z' }));
  assert.ok(await instance.restore({ userId: USER, projectId: PROJECT, revision: 2 }));
  assert.deepEqual(events.map((event) => event.eventType), ['mission.pinned', 'mission.hidden', 'mission.restored']);
  assert.equal(events.every((event) => event.userId === USER), true);
});
