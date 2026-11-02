const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFields, validateSubmissionRequest, normalizeSubmissionReceipt } = require('../src/submissionProtocol');
const { normalizeQuestionnaire } = require('../../shared/jobQuestionnaire');

test('native HH test request binds stable test, current start time and exact single/text answers', async () => {
  const questionnaire = normalizeQuestionnaire({ native: { uidPk: '42', guid: 'abc-123', testRequired: true },
    questions: [
      { id: 'task_7', label: 'Выберите вариант', type: 'single', required: true, maxLength: null,
        options: [{ id: '11', label: 'Первый' }, { id: '12', label: 'Второй' }] },
      { id: 'task_8_text', label: 'Опишите подход', type: 'text', required: true, maxLength: 1000, options: [] },
    ] });
  const input = { externalId: '123', resumeId: 'fixtureResume', letter: 'Точное письмо', questionnaire,
    answers: [{ id: 'task_7', value: '12' }, { id: 'task_8_text', value: 'Применю проверенный подход.' }],
    nativeStartTime: '2026-11-02T12:00:00Z' };
  const fields = { vacancy_id: '123', resume_hash: 'fixtureResume', letter: input.letter, lux: 'true',
    ignore_postponed: 'true', withoutTest: 'no', incomplete: 'false',
    mark_applicant_visible_in_vacancy_country: 'false', country_ids: '[]',
    uidPk: '42', guid: 'abc-123', testRequired: 'true', startTime: input.nativeStartTime,
    task_7: '12', task_8_text: 'Применю проверенный подход.' };
  const request = async (changes = {}) => {
    const form = new FormData(); for (const [name, value] of Object.entries({ ...fields, ...changes })) form.append(name, value);
    const outgoing = new Request('https://hh.ru/applicant/vacancy_response/popup', { method: 'POST', body: form });
    return { url: outgoing.url, method: outgoing.method, contentType: outgoing.headers.get('content-type'),
      body: Buffer.from(await outgoing.arrayBuffer()) };
  };
  assert.equal(validateSubmissionRequest(await request(), input), true);
  for (const changed of [{ uidPk: '43' }, { guid: 'other' }, { startTime: 'different' },
    { testRequired: 'false' }, { task_7: '11' }, { task_8_text: 'changed' }, { withoutTest: 'yes' },
    { 'task_9': 'extra' }]) assert.equal(validateSubmissionRequest(await request(changed), input), false);
});

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
    { ...data, requiredAdditionalData: { phone: true } },
    { ...data, topic_id: 0 }, { ...data, topic_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...data, responseStatus: { ...data.responseStatus, usedResumeIds: [] } },
    { ...data, responseStatus: { ...data.responseStatus, negotiations: { topicList: [{ resumeId: 999, chatId: 555 }] } } }]) {
    assert.deepEqual(normalizeSubmissionReceipt(changed, { resumeId: 'fixtureResume', externalId: '123' }), { outcome: 'unknown' });
  }
  assert.deepEqual(normalizeSubmissionReceipt(data, { resumeId: 'otherResume', externalId: '123' }), { outcome: 'unknown' });
  assert.deepEqual(normalizeSubmissionReceipt(data, { resumeId: 'fixtureResume', externalId: '124' }), { outcome: 'unknown' });
});
