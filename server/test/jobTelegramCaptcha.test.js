const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { JobCaptchaClient, normalizedAnswer, validAnswer, pngBytes } = require('../src/jobs/jobCaptchaClient');
const { parseJobCallback } = require('../src/jobs/jobTelegramCallbacks');
const { telegramReplyMarkup } = require('../src/telegram/bot');
const { loadJobConfig } = require('../src/jobs/jobConfig');
const { JobCaptchaWorker } = require('../src/jobs/jobCaptchaWorker');
const { CAPTION, refreshButtons } = require('../src/jobs/jobCaptchaService');
const ownerId = randomUUID(), token = 'fixture-captcha-token-'.repeat(3);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lYoAAAAASUVORK5CYII=', 'base64');
test('CAPTCHA closed callbacks, distinct config and literal photo caption', () => {
  assert.equal(parseJobCallback('job:captcha').action, 'captcha'); assert.equal(parseJobCallback('job:captcha_refresh').action, 'captcha_refresh');
  assert.equal(parseJobCallback('job:captcha_refresh:extra'), null); assert.ok(telegramReplyMarkup(refreshButtons));
  assert.equal(loadJobConfig({}).jobCaptchaTelegram, false);
  assert.throws(() => loadJobConfig({ JARVIS_JOB_CAPTCHA_TOKEN: token, JARVIS_JOB_BROWSER_TOKEN: token }));
  assert.ok(!CAPTION.includes('http')); assert.equal(normalizedAnswer('  ПЕРВОЕ   СЛОВО  '), 'первое слово');
  assert.equal(validAnswer('первое слово'), true); for (const s of ['english words', 'одно', 'а б', 'слово слово слово']) assert.equal(validAnswer(s), false);
  assert.equal(pngBytes(png.toString('base64')).length, png.length); assert.throws(() => pngBytes('x'.repeat(349529)));
});
test('CAPTCHA client bounded exact shape, private owner credential and PNG limits', async () => {
  let value = { phase: 'active', revision: 2 };
  const client = new JobCaptchaClient({ ownerId, token, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://job-browser:8082/rpc'); assert.equal(options.redirect, 'manual'); assert.equal(options.headers['x-jarvis-owner-id'], ownerId);
    assert.equal(options.headers.authorization, `Bearer ${token}`); return new Response(JSON.stringify({ ok: true, value }));
  } });
  assert.deepEqual(await client.status(), value);
  value = { outcome: 'ready', challengeId: randomUUID(), revision: 3, expiresAt: new Date(Date.now()+60000).toISOString(), pngBase64: png.toString('base64') };
  assert.ok(Buffer.isBuffer((await client.challenge()).png));
  value.expiresAt = 'bad'; await assert.rejects(client.challenge(), { code: 'JOB_CAPTCHA_UNAVAILABLE' });
  value = { outcome: 'solved', text: 'untrusted' }; await assert.rejects(client.answer({}), { code: 'JOB_CAPTCHA_UNAVAILABLE' });
  const large = new JobCaptchaClient({ ownerId, token, fetchImpl: async () => new Response('x', { headers: { 'content-length': '360001' } }) });
  await assert.rejects(large.status(), { code: 'JOB_CAPTCHA_UNAVAILABLE' });
});
test('unknown photo delivery blocks automatic challenges until explicit refresh', async () => {
  let refresh = false, challenges = 0;
  const worker = new JobCaptchaWorker({ ownerId, repository: { scope: async () => ({}), consumeRefresh: async () => refresh,
    hasUnknownDelivery: async () => true, enqueue: async () => {}, claim: async () => null },
    client: { status: async () => ({ phase: 'active' }), challenge: async arg => { challenges++; assert.equal(arg, true); return { outcome: 'ready', challengeId: randomUUID() }; } } });
  await worker.tick(); assert.equal(challenges, 0); refresh = true; await worker.tick(); assert.equal(challenges, 1);
});

test('foreign CAPTCHA reply rejected before any repository read', async () => {
  const { JobCaptchaService } = require('../src/jobs/jobCaptchaService');
  const service = new JobCaptchaService({ repository: { known: async () => { throw new Error('No foreign scope read'); } } });
  for (const change of [{ user: { role: 'member' } }, { user: { role: 'owner' }, input: { chatType: 'group' } }, { user: { role: 'owner' }, input: { chatId: '999' } }]) {
    const result = await service.handleReply({ replyMessageId: '12', captchaReplyHint: true, telegramUserId: '101', chatId: '101', chatType: 'private', ...change.input }, { user: change.user });
    assert.match(result.answer, /недоступна/);
  }
});

test('real private HTTP CAPTCHA broker and bounded client agree on authentication, PNG and answer wire', async () => {
  const { once } = require('node:events');
  const { createCaptchaBroker } = require('../../job-browser/src/captchaBroker');
  const challengeId = randomUUID(); let calls = 0;
  const broker = createCaptchaBroker({ ownerId, token, coordinator: { status: () => ({ phase: 'active', revision: 7 }) }, controller: {
    challenge: async refresh => { calls++; assert.equal(refresh, false); return { outcome: 'ready', challengeId, revision: 7, pngBase64: png.toString('base64'), expiresAt: new Date(Date.now()+600000).toISOString() }; },
    answer: async args => { calls++; assert.equal(args.challengeId, challengeId); assert.equal(args.revision, 7); assert.equal(args.text, 'первое слово'); return { outcome: 'solved' }; },
  } });
  broker.listen(0, '127.0.0.1'); await once(broker, 'listening');
  const baseUrl = `http://127.0.0.1:${broker.address().port}/rpc`;
  try {
    const client = new JobCaptchaClient({ ownerId, token, baseUrl, allowTestHttp: true });
    assert.deepEqual(await client.status(), { phase: 'active', revision: 7 });
    const ready = await client.challenge(false); assert.equal(ready.challengeId, challengeId); assert.deepEqual(ready.png, png);
    assert.deepEqual(await client.answer({ challengeId, revision: 7, operationId: randomUUID(), text: 'первое слово' }), { outcome: 'solved' });
    assert.equal(calls, 2);
    const foreign = new JobCaptchaClient({ ownerId: randomUUID(), token, baseUrl, allowTestHttp: true });
    await assert.rejects(foreign.challenge(), { code: 'JOB_CAPTCHA_UNAVAILABLE' }); assert.equal(calls, 2);
    const wrong = new JobCaptchaClient({ ownerId, token: token + 'wrong', baseUrl, allowTestHttp: true });
    await assert.rejects(wrong.answer({ challengeId, revision: 7, operationId: randomUUID(), text: 'первое слово' }), { code: 'JOB_CAPTCHA_UNAVAILABLE' }); assert.equal(calls, 2);
  } finally { broker.closeAllConnections(); await new Promise(resolve => broker.close(resolve)); }
});
