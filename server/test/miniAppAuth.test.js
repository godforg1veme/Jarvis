const test = require('node:test'),
  assert = require('node:assert/strict'),
  { createHmac } = require('node:crypto');
const { validateInitData } = require('../src/miniApp/initData');
const { readToken, sessionCookie } = require('../src/miniApp/sessionService');
const token = 'fixture-bot-token',
  now = 1792310400000;
function signed(extra = {}) {
  const p = new URLSearchParams({
    auth_date: String(now / 1000),
    user: JSON.stringify({ id: 101, first_name: 'Fixture' }),
    ...extra,
  });
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const check = [...p]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}
test('validates HMAC, only signed identity is authority', () => {
  assert.deepEqual(validateInitData(signed(), token, { now }), {
    telegramId: '101',
  });
  assert.throws(
    () => validateInitData(signed().replace('101', '202'), token, { now }),
    { code: 'invalid_login' },
  );
  assert.throws(
    () => validateInitData(signed() + '&user=%7B%7D', token, { now }),
    { code: 'invalid_login' },
  );
  assert.throws(
    () =>
      validateInitData(signed({ initDataUnsafe: 'forged' }), token, { now }),
    { code: 'invalid_login' },
  );
});
test('rejects stale, future, unbounded, malformed and unsafe IDs', () => {
  for (const auth_date of [String(now / 1000 - 301), String(now / 1000 + 31)])
    assert.throws(
      () => validateInitData(signed({ auth_date }), token, { now }),
      { code: 'expired_login' },
    );
  assert.throws(() => validateInitData('x'.repeat(8193), token, { now }), {
    code: 'invalid_login',
  });
  assert.throws(
    () =>
      validateInitData(
        signed({
          user: JSON.stringify({ id: 9007199254740992, first_name: 'F' }),
        }),
        token,
        { now },
      ),
    { code: 'invalid_login' },
  );
});
test('cookie cannot be confused by duplicate cookies or arbitrary strings', () => {
  const value = 'a'.repeat(64),
    cookie = sessionCookie(value).split(';')[0];
  assert.equal(readToken({ headers: { cookie } }), value);
  assert.equal(
    readToken({ headers: { cookie: `${cookie}; ${cookie}` } }),
    null,
  );
  assert.match(sessionCookie(value), /HttpOnly; Secure; SameSite=None/);
  assert.match(sessionCookie(value), /; Partitioned;/);
});
module.exports = { signed };
