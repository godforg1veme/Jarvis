const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPage } = require('../src/pageSignals');

test('security signals take precedence over login and job links', () => {
  assert.equal(classifyPage({ status: 429, text: 'Войти', vacancyLinks: 5 }).state, 'rate_limited');
  const captcha = classifyPage({ status: 200, pathname: '/account/login', text: 'Подтвердите, что вы не робот',
    iframeSources: ['https://smartcaptcha.yandexcloud.net/widget?private=fixture'], vacancyLinks: 2 });
  assert.equal(captcha.state, 'captcha'); assert.deepEqual(captcha.challenges, ['yandex_smartcaptcha']);
  assert.equal(classifyPage({ status: 403, text: 'Access denied' }).state, 'access_denied');
  assert.equal(classifyPage({ status: 200, text: 'Checking your browser before accessing' }).state, 'access_denied');
});
test('loaded provider script alone is not evidence of an active CAPTCHA', () => {
  assert.equal(classifyPage({ status: 200, pathname: '/search/vacancy', vacancyLinks: 3,
    scriptSources: ['https://www.google.com/recaptcha/api.js'] }).state, 'search');
});
test('classifications never contain input payloads and unknown is not healthy', () => {
  const input = { status: 200, pathname: '/anything', text: 'private fixture content',
    iframeSources: ['https://example.com/?secret=private-fixture'], vacancyLinks: 0 };
  assert.deepEqual(classifyPage(input), { state: 'unknown', challenges: [], vacancyLinks: 0 });
  assert.ok(!JSON.stringify(classifyPage(input)).includes('private'));
  assert.equal(classifyPage({ status: 200, pathname: '/account/login' }).state, 'login_required');
  assert.equal(classifyPage({ status: 200, pathname: '/search/vacancy', vacancyLinks: 0 }).state, 'unknown');
  assert.equal(classifyPage({ status: 200, pathname: '/vacancy/123', text: 'some unexpected page'.repeat(20) }).state, 'unknown');
  assert.equal(classifyPage({ status: 200, pathname: '/vacancy/123', vacancyContent: true }).state, 'vacancy');
});
