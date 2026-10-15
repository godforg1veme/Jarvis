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
});
