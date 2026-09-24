const assert = require('node:assert');
const { FrameSampler } = require('../vision/frameSampler');

const sampler = new FrameSampler({ sourceIntervalMs: 2000, focusedIntervalMs: 500, globalLimitPerMinute: 4 });
assert.deepStrictEqual(sampler.consider({ sourceId: 'camera-1', mode: 'temporal', at: 1000 }), { send: true, reason: 'temporal_budget' });
assert.deepStrictEqual(sampler.consider({ sourceId: 'camera-1', mode: 'temporal', at: 2000 }), { send: false, reason: 'source_rate_limit' });
assert.strictEqual(sampler.consider({ sourceId: 'display-1', mode: 'temporal', at: 2000 }).send, true);
assert.strictEqual(sampler.consider({ sourceId: 'camera-1', mode: 'focused', at: 2100 }).send, true);
assert.strictEqual(sampler.consider({ sourceId: 'display-focused', mode: 'focused', at: 2100 }).send, true);
assert.deepStrictEqual(sampler.consider({ sourceId: 'camera-1', mode: 'focused', at: 2200 }), { send: false, reason: 'focused_rate_limit' });
assert.deepStrictEqual(sampler.consider({ sourceId: 'display-2', mode: 'temporal', at: 3000 }), { send: false, reason: 'global_rate_limit' });
assert.deepStrictEqual(sampler.consider({ sourceId: 'display-3', mode: 'temporal', at: 4000 }), { send: false, reason: 'global_rate_limit' });
assert.strictEqual(sampler.consider({ sourceId: 'display-3', mode: 'temporal', at: 62000 }).send, true);
assert.throws(() => sampler.consider({ sourceId: 'x', mode: 'video', at: 63000 }), /mode/);

const reserved = new FrameSampler({ sourceIntervalMs: 1, globalLimitPerMinute: 4, temporalLimitPerMinute: 2 });
assert.equal(reserved.consider({ sourceId: 'camera', mode: 'temporal', at: 1000 }).send, true);
assert.equal(reserved.consider({ sourceId: 'screen', mode: 'temporal', at: 1000 }).send, true);
assert.deepStrictEqual(reserved.consider({ sourceId: 'other', mode: 'temporal', at: 1000 }), { send: false, reason: 'temporal_rate_limit' });
assert.equal(reserved.consider({ sourceId: 'camera', mode: 'focused', at: 1100 }).send, true, 'focused requests retain reserved budget');

console.log('[testFrameSampler] frame sampler tests passed');
