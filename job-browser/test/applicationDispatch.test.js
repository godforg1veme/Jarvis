const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchApplication } = require('../src/applicationDispatch');

const input = { externalId: '123', resumeId: 'fixtureResume', letter: 'Approved text' };
function request() {
  const body = new URLSearchParams({ vacancy_id: '123', resume_hash: input.resumeId, letter: input.letter,
    lux: 'true', ignore_postponed: 'true', withoutTest: 'no', incomplete: 'false',
    mark_applicant_visible_in_vacancy_country: 'false', country_ids: '[]' });
  return { url: () => 'https://hh.ru/applicant/vacancy_response/popup', method: () => 'POST',
    headers: () => ({ 'content-type': 'application/x-www-form-urlencoded' }), postDataBuffer: () => Buffer.from(body.toString()) };
}
const body = Buffer.from(JSON.stringify({ topic_id: 444, chat_id: 555, responseStatus: {
  resumes: { 222: { id: 222, hash: input.resumeId } }, usedResumeIds: [222],
  negotiations: { topicList: [{ id: 444, vacancyId: 123, resumeId: 222, chatId: 555 }] } } }));

test('application dispatch consumes original upstream receipt once, disposes it and hides redirects from Chromium', async () => {
  for (const status of [200, 302, 307, 308]) {
    let calls = 0, disposed = 0, rendered;
    const result = await dispatchApplication({ request,
      fetch: async options => { calls++; assert.deepEqual(options, { maxRedirects: 0, maxRetries: 0, timeout: 15000 });
        return { status: () => status, headers: () => ({ 'content-type': 'application/json', location: 'https://evil.invalid/' }),
          body: async () => body, dispose: async () => { disposed++; } }; },
      fulfill: async value => { rendered = value; }, abort: async () => {} }, input);
    assert.equal(result.outcome, status === 200 ? 'sent' : 'unknown');
    assert.equal(calls, 1); assert.equal(disposed, 1); assert.equal(rendered.status, 204);
    assert.equal(rendered.headers.location, undefined); assert.equal(rendered.body, undefined);
  }
});

test('invalid request cannot dispatch; transport failure cannot retry or fabricate a receipt', async () => {
  let calls = 0;
  const route = { request, fetch: async () => { calls++; throw Error('private transport'); }, fulfill: async () => {}, abort: async () => {} };
  assert.equal((await dispatchApplication(route, { ...input, letter: 'Changed' })).reasonCode, 'JOB_HH_SUBMISSION_BLOCKED');
  assert.equal(calls, 0);
  assert.deepEqual(await dispatchApplication(route, input), { outcome: 'unknown', reasonCode: 'JOB_HH_RECEIPT_TRANSPORT_FAILED' });
  assert.equal(calls, 1);
});

test('page teardown cannot erase an upstream verified receipt or prevent response disposal', async () => {
  let calls=0,disposed=0;
  const result=await dispatchApplication({request,fetch:async()=>{calls++;return {
    status:()=>200,headers:()=>({'content-type':'application/json'}),body:async()=>body,
    dispose:async()=>{disposed++;},
  };},fulfill:async()=>{throw Error('page closed');},abort:async()=>{throw Error('page closed');}},input);
  assert.equal(result.outcome,'sent');assert.equal(calls,1);assert.equal(disposed,1);
});

