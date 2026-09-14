const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_RULES, ProactivityEngine } = require('../src/life/proactivity/proactivityEngine');
const { createActionManifest } = require('../src/orchestrator/actionManifest');

const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const RESOURCE = '33333333-3333-4333-8333-333333333333';
const DEVICE = '44444444-4444-4444-8444-444444444444';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-09-14T10:00:00Z');

function event(extra = {}) { return { id: EVENT, user_id: USER, source_channel: 'desktop', source_device_id: DEVICE,
  structured_data: { conversationId: CONVERSATION }, confidence: 0.95, trust_level: 'trusted', ...extra }; }

function scenarios() {
  const project = { id: RESOURCE, area_id: null, name: 'Jarvis', status: 'active' };
  const commitment = { id: RESOURCE, revision: 1, title: 'Срок', status: 'open', due_at: '2026-09-14T12:00:00Z' };
  return [
    ['commitment.approaching', { kind: 'commitment', event: event(), commitment }],
    ['commitment.overdue', { kind: 'commitment', event: event(), commitment: { ...commitment, due_at: '2026-09-13T12:00:00Z' } }],
    ['project.stalled', { kind: 'project_stalled', event: event(), project, inactiveDays: 8 }],
    ['workflow.needs_attention', { kind: 'workflow_issue', event: event(), workflowStatus: 'failed', workflowId: RESOURCE }],
    ['project.document_added', { kind: 'project_document', event: event(), project }],
    ['context.lost', { kind: 'context_lost', event: event(), project, hasContinuation: true, deviceAvailable: true }],
    ['schedule.conflict', { kind: 'schedule_conflict', event: event(), commitment, conflictEvidence: true }],
    ['schedule.free_window', { kind: 'free_window', event: event(), commitment, window: { startsAt: '2026-09-14T13:00:00Z', durationMinutes: 45 } }],
    ['device.state_attention', { kind: 'device_change', event: event(), deviceId: DEVICE, deviceState: 'degraded' }],
    ['task.repeatedly_forgotten', { kind: 'forgotten_task', event: event(), project, taskTitle: 'Позвонить', missedCount: 3 }],
    ['meeting.prepare', { kind: 'meeting', event: event(), project, meeting: { startsAt: '2026-09-14T11:00:00Z', title: 'Созвон' } }],
    ['family.event_attention', { kind: 'family_event', event: event(), authorizedGrant: true, familyEvent: { startsAt: '2026-09-14T15:00:00Z', title: 'Семья' } }],
    ['smart_home.attention', { kind: 'smart_home', event: event(), deviceId: DEVICE, severity: 'critical' }],
  ];
}

test('all 13 proactivity rules produce explainable declared proposals without executing actions', async () => {
  const created = [];
  const service = { async create(input) { created.push(input); return { id: EVENT, ...input }; } };
  for (const [ruleId, signal] of scenarios()) {
    const rule = DEFAULT_RULES.find((item) => item.id === ruleId);
    const engine = new ProactivityEngine({ rules: [rule], proposalService: service, manifest: createActionManifest(), now: () => NOW });
    const rows = await engine.evaluate(signal);
    assert.equal(rows.length, 1, ruleId);
    assert.ok(rows[0].explanation, ruleId);
  }
  assert.equal(created.length, 13);
});

test('suppression, quiet mode, daily cap, low confidence and missing origin block proposals', async () => {
  let calls = 0;
  const base = scenarios()[8][1];
  const repository = { async countCreatedSince() { return 10; } };
  const engine = new ProactivityEngine({ proposalService: { async create() { calls += 1; } }, manifest: createActionManifest(), repository, now: () => NOW });
  assert.deepEqual(await engine.evaluate(base, { suppressedRules: ['device.state_attention'] }), []);
  assert.deepEqual(await engine.evaluate(base, { quiet: true }), []);
  assert.deepEqual(await engine.evaluate(base, { maxPerDay: 10 }), []);
  assert.deepEqual(await engine.evaluate({ ...base, confidence: 0.1, event: event({ confidence: 0.1 }) }), []);
  assert.deepEqual(await engine.evaluate({ ...base, event: event({ structured_data: {}, source_device_id: null }) }), []);
  assert.equal(calls, 0);
});

test('event conversion accepts family data only with a trusted resolved grant', () => {
  const engine = new ProactivityEngine();
  const family = event({ event_type: 'message.received', structured_data: { conversationId: CONVERSATION, signalType: 'family_event', familyEvent: { title: 'x', startsAt: NOW.toISOString() }, authorizedFamilyGrant: true } });
  assert.equal(engine.signalFromEvent(family, {}) , null);
  assert.equal(engine.signalFromEvent(family, { authorizedFamilyGrant: true }).authorizedGrant, true);
});
