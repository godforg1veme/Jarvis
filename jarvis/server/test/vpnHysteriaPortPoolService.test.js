const assert = require('node:assert/strict');
const test = require('node:test');
const { HysteriaPortPoolService } = require('../src/vpn/hysteriaPortPoolService');
const { normalizePortPool } = require('../src/vpn/vpnPortPoolRepository');

const DE_POOL = {
  nodeCode: 'de', generation: '123e4567-e89b-42d3-a456-426614174000',
  ports: [20011, 22229, 26549, 30013], hopIntervalSeconds: 30, revision: 1,
};

test('activeForSubscription returns only a bounded public pool per node', async () => {
  const service = new HysteriaPortPoolService({ repository: { findActive: async (node) => node === 'de' ? DE_POOL : { ...DE_POOL, nodeCode: 'nl' } } });
  const pools = await service.activeForSubscription();
  assert.deepEqual(pools.de.ports, [20011, 22229, 26549, 30013]);
  assert.equal(JSON.stringify(pools).includes('password'), false);
  assert.equal(pools.de.revision, undefined);
});

test('malformed records fail closed before subscription serialization', async () => {
  const service = new HysteriaPortPoolService({ repository: { findActive: async () => ({ ...DE_POOL, ports: [20011, 20011, 26549, 30013] }) } });
  assert.equal(await service.activeForNode('de'), null);
  assert.equal(normalizePortPool({ ...DE_POOL, nodeCode: 'xx' }), null);
});
