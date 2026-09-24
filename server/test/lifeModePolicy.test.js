const test = require('node:test');
const assert = require('node:assert/strict');
const { LIFE_MODES } = require('../src/life/modes/lifeModeSchemas');
const { getLifeModePolicy } = require('../src/life/modes/lifeModePolicy');

test('every Life mode has closed behavioral effects and invariant authority', () => {
  for (const mode of LIFE_MODES) {
    const policy = getLifeModePolicy(mode);
    assert.equal(policy.mode, mode);
    assert.ok(policy.notificationPolicy);
    assert.ok(policy.proposalVisibility);
    assert.ok(policy.missionEmphasis);
    assert.deepEqual(policy.invariants, {
      changesAuthority: false, changesPrivacy: false,
      changesFamilyAccess: false, bypassesConfirmation: false,
    });
    assert.equal(Object.isFrozen(policy), true);
  }
  assert.equal(getLifeModePolicy('injected').mode, 'work');
  assert.equal(getLifeModePolicy('emergency').invariants.bypassesConfirmation, false);
});

test('focus and sleep reduce interruptions while family and work change emphasis', () => {
  assert.equal(getLifeModePolicy('focus').notificationPolicy, 'defer_non_urgent');
  assert.equal(getLifeModePolicy('sleep').proposalVisibility, 'critical_only');
  assert.equal(getLifeModePolicy('family').missionEmphasis, 'family');
  assert.equal(getLifeModePolicy('work').missionEmphasis, 'work');
});
