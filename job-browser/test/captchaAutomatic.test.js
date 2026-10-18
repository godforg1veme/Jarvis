const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initial, validate } = require('../src/manualState');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { CaptchaAutomatic } = require('../src/captchaAutomatic');
const { CaptchaTelegramBrowser, hashKey } = require('../src/captchaTelegramBrowser');

async function fixture({ results = [], ocr = async () => 'проверка картинки', evidence, report } = {}) {
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
  const bind = () => { ctrl.coordinator = coordinator; ctrl.automatic = new CaptchaAutomatic({ coordinator, recognize: ocr, evidence, report }); };
  bind();
  return { ctrl, get coordinator() { return coordinator; }, counts: () => ({ pictures, answers }),
    restart: async () => { await restart(); ctrl.current = null; bind(); }, saved: () => saved };
}

test('first, second or third success returns idle, clears budget, and never returns a human photo', async () => {
  for (const results of [['solved'], ['new_challenge', 'solved'], ['new_challenge', 'new_challenge', 'solved']]) {
    const count = results.length, f = await fixture({ results });
    for (let i = 1; i < count; i++) assert.deepEqual(await f.ctrl.challenge(false), { outcome: 'preparing' });
    assert.deepEqual(await f.ctrl.challenge(false), { outcome: 'idle' });
    assert.equal(f.counts().answers, count); assert.equal(f.saved().automatic, undefined);
  }
});

test('three rejected attempts precede one cached human photo; ticks/refresh/restart cannot refill budget', async () => {
  const f = await fixture();
  const results = await Promise.all([f.ctrl.challenge(false), f.ctrl.challenge(false), f.ctrl.challenge(false), f.ctrl.challenge(false)]);
  assert.deepEqual(results.map(x => x.outcome), ['preparing', 'preparing', 'preparing', 'ready']);
  const photo = results[3];
  assert.equal(f.saved().automatic.attempts, 3); assert.equal(f.counts().answers, 3);
  assert.deepEqual(await f.ctrl.challenge(false), photo);
  await f.ctrl.challenge(true); await f.restart(); await f.ctrl.challenge(false);
  assert.equal(f.counts().answers, 3);
});

test('invalid OCR and OCR exceptions consume three slots without any answer submission', async () => {
  for (const ocr of [async () => 'invalid', async () => { throw new Error('private'); }]) {
    const f = await fixture({ ocr });
    assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
    assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
    assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
    assert.equal((await f.ctrl.challenge(false)).outcome, 'ready');
    assert.equal(f.counts().answers, 0); assert.equal(f.saved().automatic.attempts, 3);
  }
});

test('two completed failures survive restarts, third can succeed, and a new recovery receives its own budget', async () => {
  const f = await fixture({ results: ['new_challenge', 'new_challenge', 'solved', 'solved'] });
  assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
  await f.restart();
  assert.equal(f.saved().automatic.attempts, 1);
  assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
  await f.restart();
  assert.equal(f.saved().automatic.attempts, 2);
  assert.equal((await f.ctrl.challenge(false)).outcome, 'idle');
  await f.coordinator.pending({ target: 'https://hh.ru/vacancy/123', recoveryId: randomUUID() });
  assert.equal((await f.ctrl.challenge(false)).outcome, 'idle');
  assert.equal(f.counts().answers, 4);
});

test('upgrade preserves an existing two-attempt human handover', async () => {
  const f = await fixture();
  await f.ctrl.challenge(false); await f.ctrl.challenge(false);
  await f.coordinator.write({ automatic: { ...f.saved().automatic, phase: 'human' } });
  await f.restart();
  assert.equal((await f.ctrl.challenge(false)).outcome, 'ready');
  assert.equal(f.saved().automatic.attempts, 2);
  assert.equal(f.saved().automatic.phase, 'human');
  assert.equal(f.counts().answers, 2);
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
  assert.ok(validate({ ...base, automatic: { ...auto, attempts: 3 } }, ownerId));
  for (const patch of [{ attempts: 4 }, { attempts: 0 }, { attempts: 1.1 }, { text: 'private' }, { phase: 'other' }, { challengeHash: 'private' }]) {
    assert.throws(() => validate({ ...base, automatic: { ...auto, ...patch } }, ownerId));
  }
  assert.throws(() => validate({ ...base, automatic: auto }, randomUUID()));
  assert.throws(() => validate({ ...initial(ownerId), automatic: auto }, ownerId));
});

test('evidence saves image before OCR and exact answer before submit; outcome survives recovery completion', async () => {
  const events = [], records = new Map();
  const evidence = { start: async v => { events.push('image'); records.set('test', v); return { id: 'test' }; },
    update: async (id, patch) => { events.push(patch.phase); records.set(id, { ...records.get(id), ...patch }); } };
  const f = await fixture({ results: ['solved'], evidence, ocr: async () => {
    assert.deepEqual(events, ['image']); return ' Проверка   картинки ';
  } });
  const submit = f.ctrl.submitAnswer;
  f.ctrl.submitAnswer = async input => {
    assert.equal(records.get('test').answer, input.text); assert.equal(events.at(-1), 'dispatch_started');
    return submit(input);
  };
  assert.equal((await f.ctrl.challenge(false)).outcome, 'idle');
  assert.deepEqual(events, ['image', 'answer_saved', 'dispatch_started', 'solved']);
  assert.equal(records.get('test').phase, 'solved');
});

test('evidence failures never authorize an extra POST or leak errors to reporting', async () => {
  for (const failure of ['image', 'answer_saved', 'dispatch_started', 'new_challenge']) {
    const reports = [];
    const evidence = { start: async () => { if (failure === 'image') throw Error('private'); return { id: 'test' }; },
      update: async (_, patch) => { if (patch.phase === failure) throw Error('private'); } };
    const f = await fixture({ evidence, report: v => reports.push(v) });
    assert.equal((await f.ctrl.challenge(false)).outcome, 'preparing');
    assert.equal((await f.ctrl.challenge(false)).outcome, 'ready');
    await f.restart(); await f.ctrl.challenge(false);
    assert.equal(f.counts().answers, failure === 'new_challenge' ? 1 : 0);
    assert.deepEqual(reports, ['JOB_CAPTCHA_EVIDENCE_UNAVAILABLE']);
  }
});
