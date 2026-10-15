const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePrivacy } = require('../src/hhPrivacy');

test('existing blacklist denies its companies and permits others only after complete fresh identification', () => {
  const privacy = { mode: 'blacklist', complete: true, employerIds: ['101', '102'] };
  assert.deepEqual(evaluatePrivacy({ privacy, employerId: '101' }), { allowed: false, reasonCode: 'JOB_HH_EMPLOYER_BLOCKED' });
  assert.deepEqual(evaluatePrivacy({ privacy, employerId: '103' }), { allowed: true, reasonCode: null });
  for (const item of [{ ...privacy, complete: false }, { ...privacy, mode: 'whitelist' }, { ...privacy, employerIds: ['invalid'] }]) {
    assert.equal(evaluatePrivacy({ privacy: item, employerId: '103' }).allowed, false);
  }
  assert.equal(evaluatePrivacy({ privacy, employerId: null }).allowed, false);
});
