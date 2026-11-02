const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectForm } = require('../src/hhApplicationForm');

test('form inspection binds unique resume title and vacancy; privacy warnings and unexpected questions block automation', () => {
  const args = { externalId: '123', resumeId: 'fixtureA', resumes: [{ id: 'fixtureA', title: 'Основное резюме' }] };
  const raw = { url: 'https://hh.ru/applicant/vacancy_response?vacancyId=123', resumeTitles: ['Основное резюме'],
    fields: [{ tag: 'INPUT', type: 'hidden', name: '_xsrf' }], submitCount: 1, submitDisabled: false,
    letterInputCount: 0, letterToggleCount: 1, hiddenResumeWarning: false };
  assert.deepEqual(inspectForm(raw, args), { resumeAvailable: true, manualRequired: false, reasonCode: null });
  assert.equal(inspectForm({ ...raw, hiddenResumeWarning: true }, args).reasonCode, 'JOB_HH_RESUME_HIDDEN');
  assert.equal(inspectForm({ ...raw, text: 'Подтвердите, что вы не робот' }, args).reasonCode, 'JOB_HH_CAPTCHA_REQUIRED');
  for (const changed of [
    { url: 'https://hh.ru/applicant/vacancy_response?vacancyId=124' },
    { url: 'https://hh.ru/applicant/vacancy_response?vacancyId=123&vacancyId=124' },
    { resumeTitles: ['Другое резюме'] }, { submitDisabled: true }, { letterToggleCount: 0 },
    { fields: [...raw.fields, { tag: 'INPUT', type: 'file', name: 'attachment' }] },
    { fields: [...raw.fields, { tag: 'INPUT', type: 'hidden', name: 'unrecognized-resume' }] },
    { fields: [...raw.fields, { tag: 'TEXTAREA', qa: 'questionnaire-answer' }] },
  ]) assert.equal(inspectForm({ ...raw, ...changed }, args).manualRequired, true);
  assert.equal(inspectForm(raw, { ...args, resumeId: 'missing' }).resumeAvailable, false);
  assert.equal(inspectForm(raw, { ...args, resumes: [...args.resumes, { id: 'fixtureB', title: 'Основное резюме' }] }).resumeAvailable, false);
  assert.equal(inspectForm({ ...raw, url: 'https://hh.ru/applicant/vacancy_response/test?vacancyId=123' }, args).reasonCode,
    'JOB_HH_TEST_REQUIRED');
});

test('unrecognized labeled fields cannot be promoted to employer questions', () => {
  const args = { externalId: '123', resumeId: 'fixtureA', resumes: [{ id: 'fixtureA', title: 'Основное резюме' }] };
  const raw = { url: 'https://hh.ru/applicant/vacancy_response?vacancyId=123', resumeTitles: ['Основное резюме'],
    fields: [{ tag: 'INPUT', type: 'hidden', name: '_xsrf' },
      { tag: 'TEXTAREA', type: 'textarea', name: 'experience', label: 'Какие AI-проекты вы делали?',
        qa: 'employer-question', required: true, maxLength: 1000, options: [], inSubmitForm: true, visible: true,
        externalLink: false }],
    submitCount: 1, submitDisabled: false, letterInputCount: 0, letterToggleCount: 1, hiddenResumeWarning: false };
  const parsed = inspectForm(raw, args);
  assert.equal(parsed.reasonCode, 'JOB_HH_FORM_CHANGED');
  assert.equal(parsed.questionnaire, undefined);
  assert.equal(inspectForm({ ...raw, fields: [...raw.fields.slice(0, 1), { ...raw.fields[1], externalLink: true }] }, args).reasonCode,
    'JOB_HH_FORM_CHANGED');
  assert.equal(inspectForm({ ...raw, fields: [...raw.fields.slice(0, 1), { ...raw.fields[1], label: '' }] }, args).reasonCode,
    'JOB_HH_FORM_CHANGED');
});

test('observed HH test route admits only bounded native task controls and stable test identity', () => {
  const args = { externalId: '123', resumeId: 'fixtureA', resumes: [{ id: 'fixtureA', title: 'Основное резюме' }] };
  const nativeTest = { submitCount: 1, externalLink: false,
    fields: [
      { tag: 'INPUT', type: 'hidden', name: 'uidPk', value: '42' },
      { tag: 'INPUT', type: 'hidden', name: 'guid', value: 'abc-123' },
      { tag: 'INPUT', type: 'hidden', name: 'startTime', value: '2026-11-02T12:00:00Z' },
      { tag: 'INPUT', type: 'hidden', name: 'testRequired', value: 'true' },
      { tag: 'INPUT', type: 'radio', name: 'task_7', value: '11' },
      { tag: 'INPUT', type: 'radio', name: 'task_7', value: '12' },
      { tag: 'TEXTAREA', type: 'textarea', name: 'task_8_text', value: '' },
    ], tasks: [
      { name: 'task_7', label: 'Выберите подходящий вариант', controls: [
        { tag: 'INPUT', type: 'radio', name: 'task_7', value: '11', label: 'Первый' },
        { tag: 'INPUT', type: 'radio', name: 'task_7', value: '12', label: 'Второй' }] },
      { name: 'task_8', label: 'Опишите подход', controls: [
        { tag: 'TEXTAREA', type: 'textarea', name: 'task_8_text', value: '', maxLength: 1000 }] },
    ] };
  const raw = { url: 'https://hh.ru/applicant/vacancy_response/test?vacancyId=123', resumeTitles: ['Основное резюме'], nativeTest };
  const result = inspectForm(raw, args);
  assert.equal(result.reasonCode, 'JOB_HH_QUESTIONS_REQUIRED');
  assert.deepEqual(result.questionnaire.questions.map(q => q.id), ['task_7', 'task_8_text']);
  assert.equal(inspectForm({ ...raw, nativeTest: { ...nativeTest, externalLink: true } }, args).reasonCode, 'JOB_HH_EXTERNAL_ACTION');
  assert.equal(inspectForm({ ...raw, nativeTest: { ...nativeTest, unsupportedMedia: true } }, args).reasonCode, 'JOB_HH_TEST_REQUIRED');
  assert.equal(inspectForm({ ...raw, hiddenResumeWarning:true }, args).reasonCode,'JOB_HH_RESUME_HIDDEN');
  assert.equal(inspectForm({ ...raw, resumeTitles:['Чужое резюме'] }, args).questionnaire,undefined);
  assert.equal(inspectForm({ ...raw, nativeTest: { ...nativeTest,
    fields: [...nativeTest.fields, { tag: 'INPUT', type: 'hidden', name: 'resume_hash', value: 'other' }] } }, args).reasonCode,
  'JOB_HH_TEST_REQUIRED');
});
