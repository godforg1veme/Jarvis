const test = require('node:test');
const assert = require('node:assert/strict');
const { LifePreferenceService } = require('../src/life/preferences/lifePreferenceService');

const USER = '11111111-1111-4111-8111-111111111111';

function fixture() {
  const rows = new Map();
  const calls = [];
  const repository = {
    async list({ userId }) { calls.push(['list', userId]); return [...rows.values()]; },
    async get({ userId, key }) { calls.push(['get', userId, key]); return rows.get(key) || null; },
    async setExplicit(input) {
      calls.push(['set', input]);
      const current = rows.get(input.key);
      if (current && current.revision !== input.revision) return null;
      const row = { preference_key: input.key, value: input.value, source: 'explicit', explanation: '', evidence_count: 0, confidence: 1, revision: (current?.revision || 0) + 1 };
      rows.set(input.key, row);
      return row;
    },
    async remove({ userId, key, revision }) {
      calls.push(['remove', userId, key, revision]);
      const current = rows.get(key);
      if (!current || current.revision !== revision) return null;
      rows.delete(key);
      return current;
    },
  };
  return { calls, rows, service: new LifePreferenceService({ repository }) };
}

test('preferences expose defaults and explicit values with optimistic revisions', async () => {
  const { service } = fixture();
  const defaults = await service.list({ userId: USER });
  assert.equal(defaults.find((item) => item.key === 'response.style').value, 'balanced');
  const concise = await service.set({ userId: USER, key: 'response.style', value: 'concise' });
  assert.equal(concise.source, 'explicit');
  assert.equal(await service.set({ userId: USER, key: 'response.style', value: 'detailed' }), null);
  const detailed = await service.set({ userId: USER, key: 'response.style', value: 'detailed', revision: 1 });
  assert.equal(detailed.value, 'detailed');
});

test('reset is inspectable and deletion removes the value from future reads', async () => {
  const { service } = fixture();
  await service.set({ userId: USER, key: 'initiative.level', value: 'high' });
  const reset = await service.reset({ userId: USER, key: 'initiative.level', revision: 1 });
  assert.equal(reset.value, 'normal');
  assert.equal(reset.source, 'explicit');
  assert.ok(await service.remove({ userId: USER, key: 'initiative.level', revision: 2 }));
  const after = await service.list({ userId: USER });
  assert.equal(after.find((item) => item.key === 'initiative.level').source, 'default');
});

test('preference inputs reject unknown keys and malformed values', async () => {
  const { service } = fixture();
  await assert.rejects(service.set({ userId: USER, key: 'authority.bypass', value: true }));
  await assert.rejects(service.set({ userId: USER, key: 'notifications.quiet_hours', value: { startMinutes: -1, endMinutes: 10, timezone: 'UTC' } }));
});
