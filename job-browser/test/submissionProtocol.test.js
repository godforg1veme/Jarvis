const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFields, validateSubmissionRequest, normalizeSubmissionReceipt } = require('../src/submissionProtocol');

test('HH request guard binds exact letter/resume/vacancy and forbids visibility changes, tests, files and duplicate fields', async () => {
  const approved = { externalId: '123', resumeId: 'fixtureResume', letter: 'Точный текст\nAI & автоматизация.' };
  const fields = { vacancy_id: '123', resume_hash: approved.resumeId, letter: approved.letter,
    lux: 'true', ignore_postponed: 'true', withoutTest: 'yes', incomplete: 'false',
    mark_applicant_visible_in_vacancy_country: 'false', country_ids: '[]', hhtmFromLabel: '', hhtmSourceLabel: '' };
  const request = async (changes = {}, extras = []) => {
    const form = new FormData(); for (const [key, value] of Object.entries({ ...fields, ...changes })) form.append(key, value);
    for (const [key, value] of extras) form.append(key, value);
    const data = new Request('https://hh.ru/applicant/vacancy_response/popup', { method: 'POST', body: form });
    return { url: data.url, method: data.method, contentType: data.headers.get('content-type'), body: Buffer.from(await data.arrayBuffer()) };
  };
  assert.equal(validateSubmissionRequest(await request(), approved), true);
  for (const changed of [{ letter: `${approved.letter} ` }, { resume_hash: 'otherResume' }, { vacancy_id: '124' },
    { mark_applicant_visible_in_vacancy_country: 'true' }, { country_ids: '[113]' }, { withoutTest: 'no' }, { unexpected: 'value' }]) {
    assert.equal(validateSubmissionRequest(await request(changed), approved), false);
  }
  assert.equal(validateSubmissionRequest(await request({}, [['letter', approved.letter]]), approved), false);
  assert.equal(validateSubmissionRequest(await request({}, [['attachment', new Blob(['fixture']), 'file.txt']]), approved), false);
  assert.equal(validateSubmissionRequest({ ...await request(), url: 'https://hh.ru/applicant/vacancy_response/popup?extra=1' }, approved), false);
  assert.equal(parseFields({ contentType: 'application/json', body: Buffer.from('{}') }), null);
  assert.equal(parseFields({ contentType: 'application/x-www-form-urlencoded', body: Buffer.alloc(65537) }), null);
});

test('receipt requires a native topic/chat and source status for the exact selected resume', () => {
  const data = { topic_id: 444, chat_id: 555, responseStatus: {
    resumes: { 222: { id: 222, hash: 'fixtureResume' } }, usedResumeIds: [222], negotiations: { topicList: [{ id: 444, vacancyId: 123, resumeId: 222, chatId: 555 }] } } };
  assert.deepEqual(normalizeSubmissionReceipt(data, { resumeId: 'fixtureResume', externalId: '123' }), { outcome: 'sent', verified: true, externalId: '444' });
  for (const changed of [{ ...data, topic_id: 'SPAM' }, { ...data, chat_id: null },
    { ...data, topic_id: 0 }, { ...data, topic_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...data, responseStatus: { ...data.responseStatus, usedResumeIds: [] } },
    { ...data, responseStatus: { ...data.responseStatus, negotiations: { topicList: [{ resumeId: 999, chatId: 555 }] } } }]) {
    assert.deepEqual(normalizeSubmissionReceipt(changed, { resumeId: 'fixtureResume', externalId: '123' }), { outcome: 'unknown' });
  }
  assert.deepEqual(normalizeSubmissionReceipt(data, { resumeId: 'otherResume', externalId: '123' }), { outcome: 'unknown' });
  assert.deepEqual(normalizeSubmissionReceipt(data, { resumeId: 'fixtureResume', externalId: '124' }), { outcome: 'unknown' });
});
