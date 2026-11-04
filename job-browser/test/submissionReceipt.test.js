const test = require('node:test');
const assert = require('node:assert/strict');
const { captureSubmissionReceipt } = require('../src/submissionReceipt');

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
