const test = require('node:test');
const assert = require('node:assert/strict');
const { LifeModeService } = require('../src/life/modes/lifeModeService');

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-14T12:00:00.000Z');

test('manual and accepted-suggestion mode changes remain owner-scoped and revision-bound', async () => {
  const calls = [];
  let current = null;
  const repository = {
    async get(input) { calls.push(['get', input]); return current; },
    async set(input) {
      calls.push(['set', input]);
      if (current && input.revision !== current.revision) return null;
      current = { id: 'mode-id', mode: input.mode, source: input.source, starts_at: input.startsAt, expires_at: input.expiresAt, revision: (current?.revision || 0) + 1 };
      return current;
    },
  };
  const events = [];
  const service = new LifeModeService({ repository, gateway: { async record(event) { events.push(event); } }, now: () => NOW });
  const focus = await service.setManual({ userId: USER, sourceDeviceId: 'device-a', input: { mode: 'focus' } });
  assert.equal(focus.mode, 'focus');
  assert.equal(calls.at(-1)[1].userId, USER);
  assert.equal(events[0].structuredData.mode, 'focus');
  assert.equal(await service.acceptSuggestion({ userId: USER, input: { mode: 'rest' } }), null);
  const rest = await service.acceptSuggestion({ userId: USER, input: { mode: 'rest', revision: 1 } });
  assert.equal(rest.source, 'accepted_suggestion');
  assert.equal(rest.policy.invariants.bypassesConfirmation, false);
});

test('expired mode restores previous or default mode deterministically', async () => {
  const calls = [];
  const repository = {
    async get({ userId }) { assert.equal(userId, USER); return { mode: 'focus', source: 'manual', expires_at: '2026-09-14T11:00:00.000Z', revision: 2 }; },
    async restoreExpired(input) { calls.push(input); return { mode: 'work', source: 'manual', starts_at: input.now, expires_at: null, revision: 3 }; },
  };
  const result = await new LifeModeService({ repository, now: () => NOW }).get({ userId: USER });
  assert.equal(result.mode, 'work');
  assert.equal(result.revision, 3);
  assert.equal(calls[0].userId, USER);
});
