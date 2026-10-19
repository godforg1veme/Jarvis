const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedRequest, isApprovedHhLoginRequest } = require('../src/networkPolicy');

test('public probe cannot navigate to private services or attacker lookalike domains', () => {
  for (const url of ['http://hh.ru', 'https://127.0.0.1/', 'https://169.254.169.254/',
    'file:///etc/passwd', 'https://hh.ru.attacker.example/', 'https://attackerhh.ru/',
    'https://owner:private-fixture@hh.ru/', 'https://hh.ru:8080/']) assert.equal(allowedRequest(url), false, url);
  for (const url of ['https://hh.ru/search/vacancy', 'https://spb.hh.ru/vacancy/123',
    'https://smartcaptcha.yandexcloud.net/widget']) assert.equal(allowedRequest(url), true, url);
});

test('HH login writes are limited to direct user POSTs on the closed applicant-auth route list', () => {
  for (const [method, type, url] of [
    ['POST', 'document', 'https://hh.ru/account/login'],
    ['POST', 'fetch', 'https://passport.hh.ru/login'],
    ['POST', 'xhr', 'https://hh.ru/account/login/otp'],
  ]) assert.equal(isApprovedHhLoginRequest(method, type, url), true, url);
  for (const [method, type, url] of [
    ['GET', 'document', 'https://hh.ru/account/login'],
    ['POST', 'image', 'https://hh.ru/account/login'],
    ['POST', 'fetch', 'https://hh.ru/applicant/vacancy_response'],
    ['POST', 'fetch', 'https://hh.ru/account/login/unexpected'],
    ['POST', 'fetch', 'https://hh.ru.attacker.example/account/login'],
    ['POST', 'fetch', 'https://owner:secret@hh.ru/account/login'],
    ['POST', 'fetch', 'http://hh.ru/account/login'],
    ['POST', 'fetch', 'https://hh.ru:8443/account/login'],
  ]) assert.equal(isApprovedHhLoginRequest(method, type, url), false, `${method} ${type} ${url}`);
});
