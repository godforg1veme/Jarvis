const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { jobLoginUrl } = require('../src/jobs/jobLoginLinkDelivery');
const { telegramReplyMarkup } = require('../src/telegram/bot');

test('HH URL buttons accept only the configured origin, exact path and closed ticket fragment', () => {
  const ticket = randomBytes(32).toString('hex'), origin = 'https://jarvis.example';
  const url = jobLoginUrl(origin, ticket);
  const options = { jobLoginOrigin: origin };
  assert.deepEqual(telegramReplyMarkup([[{ text: 'Открыть вход HH', url }]], options), {
    inline_keyboard: [[{ text: 'Открыть вход HH', url }]],
  });
  for (const candidate of [url.replace('jarvis.example', 'attacker.example'),
    url.replace('/mini/job-connect/', '/mini/'), url.replace('#ticket=', '?ticket='),
    `${url}&extra=1`, url.replace('https:', 'http:'), url.replace('jarvis.example', 'jarvis.example:8443'),
    url.replace('jarvis.example', 'user@jarvis.example'), `${url}/`,
  ]) assert.throws(() => telegramReplyMarkup([[{ text: 'Вход HH', url: candidate }]], options));
  assert.throws(() => telegramReplyMarkup([[{ text: 'Вход HH', url }]]));
  assert.throws(() => telegramReplyMarkup([[{ text: 'Вход HH', url, data: 'job:menu' }]], options));
  for (const badOrigin of ['http://jarvis.example', 'https://user@jarvis.example',
    'https://jarvis.example:8443', 'https://jarvis.example/mini/'])
    assert.throws(() => jobLoginUrl(badOrigin, ticket), { code: 'JOB_LOGIN_UNAVAILABLE' });
});
