const assert = require('assert');
const { resolvePerformanceProfile } = require('../voice/sttSettings');

const quality = resolvePerformanceProfile({ performanceProfile: 'quality', beamSize: 1, vadFilter: false });
assert.strictEqual(quality.beamSize, 5);
assert.strictEqual(quality.vadFilter, true);

const efficient = resolvePerformanceProfile({ performanceProfile: 'efficient', beamSize: 5, vadFilter: true });
assert.strictEqual(efficient.beamSize, 1);
assert.strictEqual(efficient.vadFilter, false);

const custom = resolvePerformanceProfile({ performanceProfile: 'custom', beamSize: 2, vadFilter: false });
assert.strictEqual(custom.beamSize, 2);
assert.strictEqual(custom.vadFilter, false);

assert.throws(() => resolvePerformanceProfile({ performanceProfile: 'fastest' }), /Unknown/);
assert.throws(
  () => resolvePerformanceProfile({ performanceProfile: 'custom', beamSize: 0, vadFilter: true }),
  /beamSize/,
);
assert.throws(
  () => resolvePerformanceProfile({ performanceProfile: 'custom', beamSize: 1.5, vadFilter: true }),
  /beamSize/,
);
assert.throws(
  () => resolvePerformanceProfile({ performanceProfile: 'custom', beamSize: 2, vadFilter: 'yes' }),
  /vadFilter/,
);

console.log('[test] STT performance profiles OK');
