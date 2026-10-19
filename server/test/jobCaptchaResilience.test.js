const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { JobCaptchaWorker } = require('../src/jobs/jobCaptchaWorker');
const { JobCaptchaClient } = require('../src/jobs/jobCaptchaClient');
const { captchaNoticeView } = require('../src/jobs/jobCaptchaNotices');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
function fixture(options = {}) {
  let now = 100000, request = { request_id: randomUUID(), refresh_requested: true, explicit_request: true };
  const calls = { challenges: [], sends: 0, notices: [], delivered: [], reports: [], acknowledgements: [] };
  const repository = {
    scope: async () => ({}), getRequest: async () => request, recover: async () => {},
    ensureRequest: async () => request ||= { request_id: randomUUID(), explicit_request: false },
    ackRequest: async (_, id) => { calls.acknowledgements.push(id); if (request?.request_id === id) request = null; },
    notify: async (_, code, id) => calls.notices.push([code,id]),
    hasUnknownDelivery: async () => null, enqueue: async () => {},
    claim: async () => ({ id: randomUUID(), attempts: 1 }), photoState: async () => 'sent',
    delivered: async (...args) => calls.delivered.push(args),
  };
  const client = { status: async () => ({ phase: 'active' }), challenge: async (_userId, refresh) => {
    calls.challenges.push(refresh); return { outcome: 'ready', challengeId: randomUUID() };
  } };
  const worker = new JobCaptchaWorker({ ownerId: randomUUID(), repository, client,
    sendPhoto: async () => { calls.sends++; return { message_id: 123 }; }, now: () => now,
    report: code => calls.reports.push(code), ...options });
  return { worker, repository, client, calls, request: () => request, setRequest: x => { request = x; }, advance: ms => { now += ms; } };
}

test('automatic mode suppresses the early legacy attention; ordinary human mode retains it', async () => {
  for (const automatic of [true, false]) {
    let sends = 0, outcome;
    const worker = new JobDeliveryWorker({ captchaAutomatic: automatic, captchaEnabled: true,
      deliveryRepository: { claim: async () => ({ id: randomUUID(), user_id: randomUUID(), kind: 'attention', payload: { reason: 'HH_CAPTCHA' } }),
        finish: async result => { outcome = result.outcome; } },
      searchRepository: { getSettings: async () => ({ chat_id: '101' }) },
      send: async () => { sends++; return { message_id: 1 }; } });
    await worker.tick(); assert.equal(sends, automatic ? 0 : 1); assert.equal(outcome, automatic ? 'failed' : 'sent');
  }
});
test('refresh survives backend errors, exponential backoff and one safe delay notice per request', async () => {
  const f = fixture(); let attempts = 0;
  f.client.challenge = async (_userId, refresh) => { assert.equal(refresh,true); attempts++; throw Error('SECRET exception'); };
  await f.worker.tick(); assert.ok(f.request()); assert.equal(attempts,1);
  await f.worker.tick(); assert.equal(attempts,1);
  f.advance(10000); await f.worker.tick(); assert.equal(attempts,2);
  f.advance(20000); await f.worker.tick(); assert.equal(attempts,3);
  assert.equal(f.calls.notices[0][0],'PREPARATION_DELAYED'); assert.ok(f.request());
  assert.ok(f.calls.reports.every(code => code === 'JOB_CAPTCHA_PREPARATION_FAILED'));
  assert.ok(!JSON.stringify(f.calls).includes('SECRET'));
  f.client.challenge = async (_userId, refresh) => { assert.equal(refresh,true); return { outcome:'ready',challengeId:randomUUID() }; };
  f.advance(40000); await f.worker.tick(); assert.equal(f.request(),null); assert.equal(f.calls.sends,1);
});

test('automatic preparation keeps the scoped request pending and sends no Telegram photo or delay notice', async () => {
  const f = fixture();
  f.client.challenge = async (_userId, refresh) => { assert.equal(refresh, true); return { outcome: 'preparing' }; };
  f.repository.enqueue = async () => assert.fail('preparing is not an image');
  await f.worker.tick(); await f.worker.tick();
  assert.ok(f.request()); assert.equal(f.calls.sends, 0); assert.equal(f.calls.notices.length, 0);
  assert.equal(f.calls.acknowledgements.length, 0); assert.equal(f.worker.stateFor(f.worker.ownerId).failures, 0);
});
test('new explicit request bypasses old backoff and acknowledgement cannot erase a newer click', async () => {
  const f = fixture(); f.client.status = async () => { throw Error(); }; await f.worker.tick();
  const newer = { request_id:randomUUID(),refresh_requested:true,explicit_request:true }; f.setRequest(newer);
  f.client.status = async () => ({phase:'active'});
  f.client.challenge = async () => { f.setRequest({ ...newer,request_id:randomUUID() }); return {outcome:'ready',challengeId:randomUUID()}; };
  await f.worker.tick(); assert.notEqual(f.request().request_id,newer.request_id);
  assert.deepEqual(f.calls.acknowledgements,[newer.request_id]);
});
test('failed enqueue retains refresh and never sends unrecorded pixels', async () => {
  const f = fixture(); f.repository.enqueue = async () => { throw Error(); };
  await f.worker.tick(); assert.ok(f.request()); assert.equal(f.calls.sends,0);
});
test('explicit idle request receives a truthful response; checking keeps refresh pending', async () => {
  const f = fixture(); f.client.status = async () => ({phase:'checking'});
  await f.worker.tick(); assert.ok(f.request()); assert.equal(f.calls.notices.length,0);
  f.client.status = async () => ({phase:'idle'}); await f.worker.tick();
  assert.equal(f.request(),null); assert.equal(f.calls.notices[0][0],'NO_CHALLENGE'); assert.equal(f.calls.sends,0);
});
test('expired picture requests explicit refresh and sends no replacement automatically', async () => {
  const f = fixture(); f.client.challenge = async () => ({outcome:'refresh_required'});
  await f.worker.tick(); assert.equal(f.calls.sends,0); assert.equal(f.calls.notices[0][0],'REFRESH_REQUIRED');
});
test('unknown answer/photo blocks new challenges; active send lease is quiet', async () => {
  for (const blocker of ['unknown','answer_unknown','sending','answer_sending']) {
    const f = fixture(); f.setRequest(null); f.repository.hasUnknownDelivery = async () => blocker;
    await f.worker.tick(); assert.equal(f.calls.challenges.length,0); assert.equal(f.calls.sends,0);
    assert.equal(f.calls.notices.length,blocker.endsWith('sending')?0:1);
    if (blocker === 'answer_unknown') assert.equal(f.calls.notices[0][0],'ANSWER_UNKNOWN');
  }
});
test('Bot API 429 retries same photo only within attempt budget; rejection and lost ACK are terminal', async () => {
  for (const [error,attempts,outcome,notice] of [
    [{error_code:429,parameters:{retry_after:5}},1,'queued',null],
    [{error_code:429,parameters:{retry_after:5}},4,'failed','PHOTO_FAILED'],
    [{error_code:400},1,'failed','PHOTO_FAILED'],[Error('lost'),1,'unknown','PHOTO_UNKNOWN'],
  ]) {
    const f = fixture(); f.repository.claim = async () => ({id:randomUUID(),attempts});
    f.worker.sendPhoto = async () => { throw error; }; await f.worker.tick();
    assert.equal(f.calls.delivered[0][3],outcome);
    if(outcome==='queued')assert.equal(f.calls.delivered[0][4],5000);
    assert.deepEqual(f.calls.notices.map(n=>n[0]),notice?[notice]:[]);
  }
});
test('hung Telegram send is aborted, single-flight and unknown; late ACK cannot authorize a resend', async () => {
  const f = fixture({sendTimeoutMs:20}); let resolveSend, signal;
  f.worker.sendPhoto = args => { f.calls.sends++; signal=args.signal; return new Promise(resolve=>{resolveSend=resolve;}); };
  await Promise.all([f.worker.tick(),f.worker.tick()]); assert.equal(f.calls.sends,1); assert.equal(signal.aborted,true);
  assert.equal(f.calls.delivered[0][3],'unknown'); resolveSend({message_id:456});
  await Promise.resolve(); assert.equal(f.calls.delivered.length,1); assert.equal(f.worker.running,false);
});
test('all public notices use closed text and existing callback grammar', () => {
  for(const code of ['PREPARATION_DELAYED','PHOTO_UNKNOWN','ANSWER_UNKNOWN','PHOTO_FAILED','REFRESH_REQUIRED','NO_CHALLENGE']) {
    const view=captchaNoticeView(code); assert.equal(view.disableLinkPreview,true);
    assert.equal(view.buttons[0][0].data,'job:captcha_refresh'); assert.ok(!view.answer.includes('http'));
  }
  assert.equal(captchaNoticeView('__proto__'),null);
});
test('private client accepts only the exact refresh-required outcome', async () => {
  const client=new JobCaptchaClient({ownerId:randomUUID(),token:'fixture-token-'.repeat(4),fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{outcome:'refresh_required'}}))});
  assert.deepEqual(await client.challenge(),{outcome:'refresh_required'});
});
