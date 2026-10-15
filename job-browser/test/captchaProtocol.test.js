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

test('native empty-body XHR binds all query fields, current picture and CSRF header', () => {
  const answer = 'проверка картинки';
  const query = new URLSearchParams({ captchaText: answer, captchaKey: 'fixture-picture', captchaState: 'fixture',
    backurl: '/vacancy/123', failurl: form.action });
  const input = { url: `https://hh.ru/account/captcha?${query}`, method: 'POST', body: null,
    contentType: 'application/x-www-form-urlencoded', navigation: false, resourceType: 'xhr', csrfToken: 'fixture-xsrf' };
  const valid = (request, key = 'fixture-picture') => validAnswerRequest(request, form, target, answer, key);
  assert.equal(valid(input), true);
  assert.equal(valid({ ...input, body: Buffer.alloc(0) }), true);
  for (const patch of [{ method: 'GET' }, { body: Buffer.from('a=b') }, { body: undefined }, { csrfToken: 'other' },
    { csrfToken: undefined }, { navigation: true }, { resourceType: 'fetch' }, { contentType: 'application/json' }]) {
    assert.equal(valid({ ...input, ...patch }), false);
  }
  for (const key of ['', null, 'wrong', 'a\nb', 'a'.repeat(1025)]) assert.equal(valid(input, key), false);
  assert.equal(validAnswerRequest(input, form, target, answer), false);
  for (const name of query.keys()) {
    const bad = new URL(input.url); bad.searchParams.set(name, 'wrong');
    assert.equal(valid({ ...input, url: bad.href }), false, name);
    const duplicate = new URL(input.url); duplicate.searchParams.append(name, query.get(name));
    assert.equal(valid({ ...input, url: duplicate.href }), false, `duplicate ${name}`);
  }
  for (const url of [input.url + '&extra=true', input.url + '#fragment', input.url.replace('hh.ru', 'evil.example'),
    input.url.replace('hh.ru', 'user@hh.ru'), input.url.replace('/account/captcha', '/applicant/vacancy_response')]) {
    assert.equal(valid({ ...input, url }), false);
  }
});
