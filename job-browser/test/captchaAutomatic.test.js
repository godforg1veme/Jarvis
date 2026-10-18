const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initial, validate } = require('../src/manualState');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { CaptchaAutomatic } = require('../src/captchaAutomatic');
const { CaptchaTelegramBrowser, hashKey } = require('../src/captchaTelegramBrowser');

async function fixture({ results = [], ocr = async () => 'проверка картинки' } = {}) {
  const ownerId = randomUUID(); let saved = initial(ownerId), pictures = 0, answers = 0;
  const store = { read: async () => structuredClone(saved), write: async value => {
    saved = structuredClone(validate(value, ownerId)); return structuredClone(saved);
  } };
  let coordinator;
  const restart = async () => {
    coordinator = new ManualCoordinator({ store, open: async () => {}, verify: async () => false });
    await coordinator.load(); return coordinator;
  };
  await restart();
  await coordinator.pending({ target: 'https://hh.ru/vacancy/123', recoveryId: randomUUID() });
  const ctrl = new CaptchaTelegramBrowser({ coordinator });
  ctrl.issueChallenge = async () => {
    if (coordinator.state.phase === 'pending') await coordinator.start(coordinator.state.revision);
    if (ctrl.current && !ctrl.current.used && coordinator.state.automatic?.phase === 'human') return ctrl.current.public;
    const key = `fixture-${++pictures}`;
    const value = { outcome: 'ready', challengeId: randomUUID(), revision: coordinator.state.revision, pngBase64: Buffer.from('png').toString('base64') };
    ctrl.current = { key, used: false, public: value }; return value;
  };
  ctrl.submitAnswer = async () => {
    answers++; await coordinator.claimMany([hashKey(ctrl.current.key)]); ctrl.current.used = true;
    const outcome = results.shift() || 'new_challenge';
    if (outcome === 'throw') throw new Error('private');
    if (outcome === 'solved') await coordinator.write({ phase: 'idle', target: null, recoveryId: null, claims: [], seedRequired: false });
    return { outcome };
  };
  const bind = () => { ctrl.coordinator = coordinator; ctrl.automatic = new CaptchaAutomatic({ coordinator, recognize: ocr }); };
  bind();
  return { ctrl, get coordinator() { return coordinator; }, counts: () => ({ pictures, answers }),
    restart: async () => { await restart(); ctrl.current = null; bind(); }, saved: () => saved };
}

test('first or second success returns idle, clears budget, and never returns a human photo', async () => {
  for (const results of [['solved'], ['new_challenge', 'solved']]) {
    const count = results.length, f = await fixture({ results });
    if (count === 2) assert.deepEqual(await f.ctrl.challenge(false), { outcome: 'preparing' });
    assert.deepEqual(await f.ctrl.challenge(false), { outcome: 'idle' });
    assert.equal(f.counts().answers, count); assert.equal(f.saved().automatic, undefined);
  }
});

test('two rejected attempts precede one cached human photo; ticks/refresh/restart cannot refill budget', async () => {
  const f = await fixture();
  const results = await Promise.all([f.ctrl.challenge(false), f.ctrl.challenge(false), f.ctrl.challenge(false)]);
  assert.deepEqual(results.map(x => x.outcome), ['preparing', 'preparing', 'ready']);
  const photo = results[2];
  assert.equal(f.saved().automatic.attempts, 2); assert.equal(f.counts().answers, 2);
  assert.deepEqual(await f.ctrl.challenge(false), photo);
  await f.ctrl.challenge(true); await f.restart(); await f.ctrl.challenge(false);
  assert.equal(f.counts().answers, 2);
});

test('invalid OCR and OCR exceptions consume two slots without any answer submission', async () => {
  for (const ocr of [async () => 'invalid', async () => { throw new Error('private'); }]) {
    const f = await fixture({ ocr });
    assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
    assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
    assert.equal((await f.ctrl.challenge(false)).outcome, 'ready');
    assert.equal(f.counts().answers, 0); assert.equal(f.saved().automatic.attempts, 2);
  }
});

test('completed first failure survives restart and a new resolved recovery receives its own budget', async () => {
  const f = await fixture({ results: ['new_challenge', 'solved', 'solved'] });
  assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
  await f.restart();
  assert.equal(f.saved().automatic.attempts, 1);
  assert.equal((await f.ctrl.challenge(false)).outcome, 'idle');
  await f.coordinator.pending({ target: 'https://hh.ru/vacancy/123', recoveryId: randomUUID() });
  assert.equal((await f.ctrl.challenge(false)).outcome, 'idle');
  assert.equal(f.counts().answers, 3);
});

test('unknown answer and post-claim exception immediately hand over without another automatic POST', async () => {
  for (const outcome of ['unknown', 'throw', 'stale', 'already_used']) {
    const f = await fixture({ results: [outcome] });
    assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
    assert.equal((await f.ctrl.challenge(false)).outcome, 'ready');
    assert.equal(f.counts().answers, 1); assert.equal(f.saved().automatic.phase, 'human');
  }
});

test('interrupted durable attempt, existing human claims and repeated key never grant another automatic answer', async () => {
  const f = await fixture(); await f.coordinator.start(f.coordinator.status().revision);
  await f.coordinator.beginAutomatic(hashKey('interrupted')); await f.restart();
  assert.equal(f.saved().automatic.phase, 'human');
  assert.equal((await f.ctrl.challenge(false)).outcome, 'ready'); assert.equal(f.counts().answers, 0);
  const g = await fixture(); await g.coordinator.start(g.coordinator.status().revision);
  await g.coordinator.claim(hashKey('legacy'));
  assert.equal((await g.ctrl.challenge(false)).outcome, 'ready'); assert.equal(g.counts().answers, 0);
  const h = await fixture({ ocr: async () => 'invalid' });
  await h.ctrl.challenge(false);
  const issue = h.ctrl.issueChallenge;
  h.ctrl.issueChallenge = async refresh => { const r = await issue(refresh); h.ctrl.current.key = 'fixture-1'; return r; };
  assert.equal((await h.ctrl.challenge(false)).outcome, 'ready');
  assert.equal(h.saved().automatic.attempts, 1); assert.equal(h.saved().automatic.phase, 'human');
  const inProcess = await fixture(); await inProcess.coordinator.start(inProcess.coordinator.status().revision);
  await inProcess.coordinator.beginAutomatic(hashKey('in-process-checkpoint'));
  assert.equal((await inProcess.ctrl.challenge(false)).outcome, 'ready');
  assert.equal(inProcess.saved().automatic.phase, 'human'); assert.equal(inProcess.counts().answers, 0);
});

test('automatic state is closed, bounded and owner-scoped', () => {
  const ownerId = randomUUID(), base = { ...initial(ownerId), phase: 'active', target: 'https://hh.ru/vacancy/123', recoveryId: randomUUID() };
  const auto = { attempts: 1, phase: 'running', challengeHash: 'a'.repeat(64) };
  assert.ok(validate({ ...base, automatic: auto }, ownerId));
  for (const patch of [{ attempts: 3 }, { attempts: 0 }, { attempts: 1.1 }, { text: 'private' }, { phase: 'other' }, { challengeHash: 'private' }]) {
    assert.throws(() => validate({ ...base, automatic: { ...auto, ...patch } }, ownerId));
  }
  assert.throws(() => validate({ ...base, automatic: auto }, randomUUID()));
  assert.throws(() => validate({ ...initial(ownerId), automatic: auto }, ownerId));
});
