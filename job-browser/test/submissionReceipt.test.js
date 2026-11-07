const test = require('node:test');
const assert = require('node:assert/strict');
const { captureSubmissionReceipt, readSubmissionReceipt } = require('../src/submissionReceipt');

const input = { resumeId: 'fixtureResume', externalId: '123' };
const receipt = JSON.stringify({ topic_id: 444, chat_id: 555, responseStatus: {
  resumes: { 222: { id: 222, hash: input.resumeId } }, usedResumeIds: [222],
  negotiations: { topicList: [{ id: 444, vacancyId: 123, resumeId: 222, chatId: 555 }] },
} });

test('receipt body reading begins at response event before submit click finishes', async () => {
  let deliver, bodyStarted = false, invalidated = false;
  const request = {};
  const page = { waitForResponse(predicate) {
    return new Promise((resolve) => { deliver = (response) => { assert.equal(predicate(response), true); resolve(response); }; });
  } };
  const response = { request: () => request, status: () => 200,
    headers: () => ({ 'content-type': 'application/json' }),
    body() { bodyStarted = true; if (invalidated) throw Error('body lost after navigation');
      return Promise.resolve(Buffer.from(receipt)); } };
  const captured = captureSubmissionReceipt({ page, request: () => request, timeoutMs: 250, input });
  async function click() { deliver(response); await Promise.resolve();
    assert.equal(bodyStarted, true); invalidated = true; }
  await click();
  assert.deepEqual(await captured, { outcome: 'sent', verified: true, externalId: '444' });
});

test('receipt failures remain unknown with closed metadata, body and format reasons', async () => {
  const get = (response) => captureSubmissionReceipt({ page: { waitForResponse: async () => response },
    request: () => ({}), timeoutMs: 250, input });
  const base = { status: () => 200, headers: () => ({ 'content-type': 'application/json' }) };
  assert.deepEqual(await get({ ...base, body: () => { throw Error('private transport'); } }),
    { outcome: 'unknown', reasonCode: 'JOB_HH_RECEIPT_BODY_FAILED' });
  assert.deepEqual(await get({ ...base, headers: () => { throw Error('private headers'); } }),
    { outcome: 'unknown', reasonCode: 'JOB_HH_RECEIPT_META_FAILED' });
  assert.deepEqual(await get({ ...base, body: async () => Buffer.from('{') }),
    { outcome: 'unknown', reasonCode: 'JOB_HH_RECEIPT_FORMAT' });
  assert.deepEqual(await get({ ...base, body: async () => Buffer.alloc(1048577) }),
    { outcome: 'unknown', reasonCode: 'JOB_HH_RECEIPT_FORMAT' });
});

test('HTTP failure categories expose no response text or redirect location and never establish success', async () => {
  for(const [status,headers,body,code] of [
    [302,{location:'/account/captcha?state=private-marker'},'', 'CAPTCHA'],
    [307,{location:'https://other.invalid/account/captcha?private-marker'},'', 'REDIRECT'],
    [302,{location:'/account/login?private-marker'},'', 'AUTH_REQUIRED'],
    [401,{},'', 'AUTH_REQUIRED'],[403,{},'', 'FORBIDDEN'],[429,{},'', 'RATE_LIMITED'],
    [503,{},'', 'SERVER_ERROR'],[422,{},'', 'CLIENT_ERROR'],
    [403,{'content-type':'text/plain'},'XSRF cookie does not match POST body','XSRF_REJECTED'],
  ]) {
    if(body)headers['content-length']=String(Buffer.byteLength(body));
    const result=await readSubmissionReceipt({status:()=>status,headers:()=>headers,body:async()=>Buffer.from(body)},input);
    assert.equal(result.outcome,'unknown');
    assert.equal(result.reasonCode,`JOB_HH_RECEIPT_${code}`);
    if(status===403)assert.deepEqual(result.submissionDiagnostic,{
      status:403,responseClass:body?'small_text':'missing_length',
      errorClass:body?'xsrf_rejected':'body_unavailable',xsrf:'unavailable',xsrfCookie:'unavailable',
      xsrfHeader:'unavailable',xsrfHeaderBody:'unavailable',
      origin:'missing',referer:'missing'});
    else assert.equal(result.submissionDiagnostic,undefined);
    assert.equal(JSON.stringify(result).includes('private-marker'),false);
  }
});
