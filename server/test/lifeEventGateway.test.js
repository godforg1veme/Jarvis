const test = require('node:test');
const assert = require('node:assert/strict');
const { LifeEventGateway } = require('../src/life/lifeEventGateway');

test('disabled gateway preserves source behavior without touching persistence', async () => {
  let calls = 0;
  const gateway = new LifeEventGateway({ repository: { async create() { calls += 1; } }, enabled: false });
  assert.equal(await gateway.record({}), null);
  assert.equal(calls, 0);
});

test('gateway returns a persisted event and degrades safely on persistence failure', async () => {
  const expected = { id: 'event-a' };
  const gateway = new LifeEventGateway({ repository: { async create() { return expected; } } });
  assert.equal(await gateway.record({ eventType: 'message.received' }), expected);

  const warnings = [];
  const failing = new LifeEventGateway({
    repository: { async create() { throw new Error('database secret detail'); } },
    logger: { warn(metadata, message) { warnings.push({ metadata, message }); } },
  });
  assert.equal(await failing.record({ eventType: 'message.received', sourceChannel: 'telegram', summary: 'private' }), null);
  assert.deepEqual(warnings[0].metadata, {
    eventType: 'message.received',
    sourceChannel: 'telegram',
    errorCode: 'LIFE_EVENT_WRITE_FAILED',
  });
  assert.equal(JSON.stringify(warnings).includes('database secret detail'), false);
  assert.equal(JSON.stringify(warnings).includes('private'), false);
});
