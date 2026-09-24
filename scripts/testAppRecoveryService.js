const assert = require('assert');
const { AppRecoveryRegistry } = require('../tools/appRecoveryRegistry');
const { AppRecoveryService } = require('../tools/appRecoveryService');

let nextId = 0;
const registry = new AppRecoveryRegistry({ randomId: () => String(++nextId), now: () => 1000 });
const stored = [];
const service = new AppRecoveryService({
  registry,
  appResolver: { resolve: () => ({ ok: false, notFound: true }) },
  discovery: {
    discoverQuick: async () => ({ candidates: [{ name: 'Obsidian', type: 'exe', path: 'D:\\Apps\\Obsidian.exe', source: 'disk-scan' }] }),
    discoverExtended: async () => ({ candidates: [] }),
  },
  validatorOptions: { existsSync: () => true, randomId: () => String(++nextId) },
  matcher: async (_query, candidates) => ({
    mode: 'single', candidates: [candidates[0]], aliases: ['обсидиан'], aiUsed: true,
    matchedCandidateId: candidates[0].candidateId,
  }),
  launcher: async () => ({ ok: true, type: 'run', message: 'started' }),
  store: {
    load: () => ({ schemaVersion: 1, apps: [] }),
    upsert: value => { stored.push(value); return { record: value, savedAliases: value.aliases, skippedAliases: [] }; },
  },
});

(async () => {
  const pending = await service.start('открой обсидиан', { inputChannel: 'text', extended: false, apiKey: 'x' });
  assert.strictEqual(pending.state, 'awaiting_confirmation');
  assert.strictEqual(pending.candidates.length, 1);
  assert.strictEqual(pending.candidates[0].target, undefined);
  const details = service.details(pending.recoveryId, pending.candidates[0].candidateId);
  assert.strictEqual(details.target, 'D:\\Apps\\Obsidian.exe');
  const done = await service.confirm(pending.recoveryId);
  assert.strictEqual(done.state, 'completed');
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].aliases.includes('обсидиан'), true);
  assert.strictEqual(JSON.stringify(done).includes('D:\\\\Apps'), false);

  const first = await service.start('first', { extended: false });
  const second = await service.start('second', { extended: false });
  assert.strictEqual(registry.get(first.recoveryId, { active: false }).state, 'cancelled');
  service.cancel(second.recoveryId);
  assert.strictEqual(registry.get(second.recoveryId, { active: false }).state, 'cancelled');

  let clock = 0;
  const expiringRegistry = new AppRecoveryRegistry({
    randomId: () => 'expiring',
    now: () => clock,
    candidateTtlMs: 100,
  });
  const expiring = expiringRegistry.create('temporary');
  clock = 101;
  assert.throws(() => expiringRegistry.get(expiring.recoveryId), /unknown recoveryId/);
  assert.strictEqual(expiring.abortController.signal.aborted, true);
  console.log('testAppRecoveryService: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
