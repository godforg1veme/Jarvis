const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { initial, validate, validTarget } = require('../src/manualState');
const { ManualCoordinator } = require('../src/manualCoordinator');
function fixture({ verify = async () => false, open = async () => {} } = {}) {
  const ownerId = randomUUID(); let saved = initial(ownerId);
  const store = { read: async () => structuredClone(saved), write: async (s) => { saved = structuredClone(validate(s, ownerId)); return structuredClone(saved); } };
  const create = () => new ManualCoordinator({ store, open, verify });
  return { ownerId, create, recoveryId: randomUUID(), target: 'https://hh.ru/vacancy/123' };
}
test('manual state: closed owner/shape/target, no public or secret-bearing navigation', () => {
  const owner = randomUUID(), state = initial(owner);
  assert.equal(validate(state, owner), state);
  for (const patch of [{ ownerId: randomUUID() }, { extra: true }, { claims: ['payload'] }, { revision: -1 }]) {
    assert.throws(() => validate({ ...state, ...patch }, owner), { code: 'JOB_MANUAL_STATE_DENIED' });
  }
  assert.equal(validTarget('https://hh.ru/vacancy/123'), true);
  for (const target of ['https://evil.example/vacancy/123', 'https://hh.ru/account/captcha?state=secret',
    'https://hh.ru/vacancy/123?token=secret', 'https://user@hh.ru/vacancy/123', 'https://hh.ru/vacancy/123#fragment']) assert.equal(validTarget(target), false);
});
test('manual mode survives restart and elapsed time until successful explicit finish, with replay safety', async () => {
  let okay = false, reads = 0, opens = 0;
  const f = fixture({ open: async () => { opens++; }, verify: async () => { reads++; return okay; } });
  let m = f.create(); await m.load(); m.assertAutomatic();
  const pending = await m.pending(f); assert.equal(pending.phase, 'pending');
  assert.throws(() => m.assertAutomatic(), { code: 'JOB_HH_MANUAL_ACTIVE' });
  const [a, duplicate] = await Promise.all([m.start(pending.revision), m.start(pending.revision)]);
  assert.deepEqual(a, duplicate); assert.equal(opens, 1);
  await assert.rejects(m.finish(0), { code: 'JOB_MANUAL_REVISION_CONFLICT' });
  const failed = await m.finish(a.revision); assert.equal(failed.phase, 'active');
  assert.deepEqual(await m.finish(a.revision), failed); assert.equal(reads, 1);
  // No TTL/clock is part of durable mode: a later process still sees active.
  m = f.create(); await m.load(); assert.equal(m.status().phase, 'active');
  okay = true; const result = await m.finish(failed.revision); assert.equal(result.phase, 'idle');
  assert.equal(reads, 2); m.assertAutomatic();
  assert.deepEqual(await m.finish(failed.revision), result); assert.equal(reads, 2);
});
test('manual challenge claim persists before dispatch, is single-use and keeps revision stable', async () => {
  const f = fixture(), m = f.create(); await m.load(); await m.pending(f);
  const active = await m.start(m.status().revision);
  const key = createHash('sha256').update('fixture-challenge').digest('hex');
  const claims = await Promise.allSettled([m.claim(key), m.claim(key)]);
  assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
  assert.deepEqual(m.status(), active);
  const restart = f.create(); await restart.load();
  await assert.rejects(restart.claim(key), { code: 'JOB_MANUAL_CHALLENGE_ALREADY_ATTEMPTED' });
});
test('manual checking restart fails closed into active; checking refuses captcha writes without waiting for verify', async () => {
  let release, entered;
  const started = new Promise((r) => { entered = r; });
  const f = fixture({ verify: () => { entered(); return new Promise((r) => { release = r; }); } });
  const m = f.create(); await m.load(); await m.pending(f); await m.start(m.status().revision);
  const finish = m.finish(m.status().revision); await started;
  await assert.rejects(m.claim('a'.repeat(64)), { code: 'JOB_HH_MANUAL_ACTIVE' });
  const restart = f.create(); await restart.load(); assert.equal(restart.status().phase, 'active');
  release(false); await finish;
});

test('manual legacy baseline and imported automatic challenge cannot be replayed after refresh or restart', async () => {
  const f = fixture(), m = f.create(); await m.load();
  const key = 'f'.repeat(64);
  await m.pending({ ...f, seedRequired: true }); await m.start(m.status().revision);
  await assert.rejects(m.claim(key), { code: 'JOB_MANUAL_CHALLENGE_ALREADY_ATTEMPTED' });
  await m.seedBaseline(key, m.status().revision);
  await assert.rejects(m.claim(key), { code: 'JOB_MANUAL_CHALLENGE_ALREADY_ATTEMPTED' });
  await m.start(m.status().revision);
  const restart = f.create(); await restart.load();
  await assert.rejects(restart.claim(key), { code: 'JOB_MANUAL_CHALLENGE_ALREADY_ATTEMPTED' });
  assert.equal(await restart.claim('e'.repeat(64)), true);
});

test('Linux manual state refuses foreign owner, unsafe mode, oversized file and symlinks', { skip: process.platform !== 'linux' }, async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const { ManualState, assertInactiveWhenDisabled } = require('../src/manualState');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manual-state-')); await fs.chmod(root, 0o700);
  const ownerId = randomUUID(), store = new ManualState({ root, ownerId }), file = path.join(root, 'state.json');
  try {
    await store.write(initial(ownerId));
    await assertInactiveWhenDisabled({ root, ownerId });
    await store.write({ ...initial(ownerId), phase: 'active', recoveryId: randomUUID(), target: 'https://hh.ru/vacancy/123' });
    await assert.rejects(assertInactiveWhenDisabled({ root, ownerId }), { code: 'JOB_HH_MANUAL_ACTIVE' });
    await store.write(initial(ownerId));
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await assert.rejects(new ManualState({ root, ownerId: randomUUID() }).read(), { code: 'JOB_MANUAL_STATE_DENIED' });
    await fs.chmod(file, 0o644); await assert.rejects(store.read(), { code: 'JOB_MANUAL_STATE_DENIED' });
    await fs.chmod(file, 0o600); await fs.writeFile(file, 'x'.repeat(16385)); await assert.rejects(store.read(), { code: 'JOB_MANUAL_STATE_DENIED' });
    await fs.unlink(file); await fs.symlink(path.join(root, 'other'), file); await assert.rejects(store.read(), { code: 'JOB_MANUAL_STATE_DENIED' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
