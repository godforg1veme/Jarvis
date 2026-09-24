const test = require('node:test');
const assert = require('node:assert/strict');
const { LifeProjectionWorker } = require('../src/life/lifeProjectionWorker');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';

test('worker creates only trusted links from allowlisted structured identifiers', async () => {
  const links = [];
  const completed = [];
  const eventRepository = {
    async claimPending() {
      return {
        claimToken: '55555555-5555-4555-8555-555555555555',
        events: [{
          id: EVENT_ID,
          user_id: USER_ID,
          structured_data: {
            projectId: PROJECT_ID,
            conversationId: CONVERSATION_ID,
            arbitraryId: '66666666-6666-4666-8666-666666666666',
          },
        }],
      };
    },
    async markProcessed(input) { completed.push(input); },
    async markFailed() { throw new Error('unexpected failure'); },
  };
  const worker = new LifeProjectionWorker({
    eventRepository,
    projectionRepository: { async createLink(input) { links.push(input); } },
  });
  assert.equal(await worker.tick(), 1);
  assert.deepEqual(links.map((link) => link.targetType), ['project', 'conversation']);
  assert.ok(links.every((link) => link.userId === USER_ID && link.origin === 'trusted'));
  assert.equal(completed.length, 1);
});

test('worker records a bounded failure code and never logs source content', async () => {
  const failures = [];
  const warnings = [];
  const worker = new LifeProjectionWorker({
    eventRepository: {
      async claimPending() {
        return { claimToken: 'claim-a', events: [{ id: EVENT_ID, user_id: USER_ID, summary: 'secret', structured_data: { projectId: PROJECT_ID } }] };
      },
      async markProcessed() { throw new Error('unexpected completion'); },
      async markFailed(input) { failures.push(input); },
    },
    projectionRepository: { async createLink() { throw new Error('private database detail'); } },
    logger: { warn(metadata, message) { warnings.push({ metadata, message }); } },
  });
  assert.equal(await worker.tick(), 1);
  assert.equal(failures[0].errorCode, 'LIFE_PROJECTION_FAILED');
  assert.equal(JSON.stringify(warnings).includes('secret'), false);
  assert.equal(JSON.stringify(warnings).includes('private database detail'), false);
});

test('worker prevents overlapping ticks', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const worker = new LifeProjectionWorker({
    eventRepository: {
      async claimPending() { await waiting; return { claimToken: 'claim-a', events: [] }; },
    },
    projectionRepository: {},
  });
  const first = worker.tick();
  assert.equal(await worker.tick(), 0);
  release();
  assert.equal(await first, 0);
});
