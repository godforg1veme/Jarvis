const test = require('node:test');
const assert = require('node:assert/strict');
const { GuardedSubmission } = require('../src/guardedSubmission');
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = { userId: ownerId, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  externalId: '123', resumeId: 'fixtureResume', letter: 'Approved' };
test('preparation exception before any ledger claim is a known non-send; failed claim stays uncertain', async () => {
  let claims = 0, clicks = 0;
  const ledger = { async lookup() { return { outcome: 'unknown' }; }, async hasClaim() { return false; },
    async reserve() { claims++; throw Error(); } };
  const driver = { async prepare() { throw Error(); }, async close() {}, async clickAndVerify() { clicks++; } };
  const guarded = new GuardedSubmission({ ownerId, primaryResumeId: input.resumeId, ledger, driver });
  assert.deepEqual(await guarded.submit(input), { outcome: 'manual_required', verified: true, reasonCode: 'JOB_HH_PREPARATION_FAILED' });
  assert.equal(claims, 0); assert.equal(clicks, 0);
  driver.prepare = async () => ({ ready: true });
  assert.deepEqual(await guarded.submit(input), { outcome: 'unknown' });
  assert.equal(claims, 1); assert.equal(clicks, 0);
});
