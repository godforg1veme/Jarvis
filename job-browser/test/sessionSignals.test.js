const test = require('node:test');
const assert = require('node:assert/strict');
const { classifySession } = require('../src/pageSignals');

test('session proof accepts actual private profile redirect and rejects public lookalikes', () => {
  const privatePage = { status: 200, pathname: '/applicant/profile/synthetic-owner', text: 'Мои резюме' };
  assert.equal(classifySession(privatePage).authenticated, true);
  for (const change of [{ pathname: '/' }, { pathname: '/account/login' }, { status: 403 },
    { status: 502 }, { pathname: '/unknown' }, { text: 'Подтвердите, что вы не робот' },
    { iframeSources: ['https://smartcaptcha.yandexcloud.net/fixture?private=synthetic'] }]) {
    assert.equal(classifySession({ ...privatePage, ...change }).authenticated, false);
  }
  assert.ok(!JSON.stringify(classifySession(privatePage)).includes('synthetic-owner'));
});
