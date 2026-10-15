const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedRequest } = require('../src/networkPolicy');

test('public probe cannot navigate to private services or attacker lookalike domains', () => {
  for (const url of ['http://hh.ru', 'https://127.0.0.1/', 'https://169.254.169.254/',
    'file:///etc/passwd', 'https://hh.ru.attacker.example/', 'https://attackerhh.ru/',
    'https://owner:private-fixture@hh.ru/', 'https://hh.ru:8080/']) assert.equal(allowedRequest(url), false, url);
  for (const url of ['https://hh.ru/search/vacancy', 'https://spb.hh.ru/vacancy/123',
    'https://smartcaptcha.yandexcloud.net/widget']) assert.equal(allowedRequest(url), true, url);
});
