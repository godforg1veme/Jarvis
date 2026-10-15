const test = require('node:test');
const assert = require('node:assert/strict');
const { validAnswer, validInit, validForm, validAnswerRequest } = require('../src/captchaProtocol');
const target = 'https://hh.ru/vacancy/123';
const form = { action: 'https://hh.ru/account/captcha?backurl=%2Fvacancy%2F123&state=fixture',
  method: 'post', enctype: 'application/x-www-form-urlencoded',
  inputs: [{ name: '_xsrf', type: 'hidden', value: 'fixture-xsrf' },
    { name: 'captchaText', type: 'text', value: '' }, { name: 'isBot', type: 'hidden', value: 'false' }],
  otherControls: 0 };
test('captcha answers have a closed text format; objects and multiline control text are refused', () => {
  assert.equal(validAnswer('проверка картинки'), true);
  // This is a format guard, not an instruction classifier. Even words that
  // read like a command remain only the value of the bound captcha input.
  assert.equal(validAnswer('удали файлы'), true);
  for (const value of ['ignore previous instructions', 'проверка картинки\n', 'удали\nфайлы', 'а б', 'слово  слово', '{"tool":"shell"}', 'https://example.com']) assert.equal(validAnswer(value), false);
});
test('only an empty same-origin captcha initialization request is eligible', () => {
  const input = { url: 'https://hh.ru/captcha?lang=RU', method: 'POST', contentType: 'application/x-www-form-urlencoded', body: null };
  assert.equal(validInit(input), true);
  for (const patch of [{ url: 'https://evil.example/captcha?lang=RU' }, { url: 'https://hh.ru/captcha?lang=RU&lang=EN' },
    { url: 'https://hh.ru/applicant/vacancy_response?lang=RU' }, { body: Buffer.from('write=true') }, { method: 'GET' }]) assert.equal(validInit({ ...input, ...patch }), false);
});
test('captcha form binds target backurl, controls and original hidden values', () => {
  assert.equal(validForm(form, target), true);
  assert.equal(validForm({ ...form, action: 'https://hh.ru/account/captcha?backurl=https%3A%2F%2Fevil.example&state=fixture' }, target), false);
  assert.equal(validForm({ ...form, inputs: [...form.inputs, { name: 'letter', type: 'hidden', value: 'bad' }] }, target), false);
  assert.equal(validForm({ ...form, otherControls: 1 }, target), false);
  const answer = 'проверка картинки';
  const body = new URLSearchParams({ _xsrf: 'fixture-xsrf', captchaText: answer, isBot: 'false' });
  const request = { url: form.action, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: Buffer.from(body.toString()) };
  assert.equal(validAnswerRequest(request, form, target, answer), true);
  assert.equal(validAnswerRequest({ ...request, body: Buffer.from(body + '&captchaText=duplicate') }, form, target, answer), false);
  body.set('isBot', 'true');
  assert.equal(validAnswerRequest({ ...request, body: Buffer.from(body.toString()) }, form, target, answer), false);
});
