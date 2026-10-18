const { createHmac, timingSafeEqual } = require('node:crypto');
const { accessError } = require('../access/accessPolicy');
function validateInitData(
  initData,
  botToken,
  { now = Date.now(), maxAgeSeconds = 300 } = {},
) {
  if (
    typeof initData !== 'string' ||
    !initData ||
    Buffer.byteLength(initData) > 8192 ||
    !botToken
  )
    throw accessError('invalid_login');
  const params = new URLSearchParams(initData),
    seen = new Set();
  for (const [key, value] of params) {
    if (
      seen.has(key) ||
      ![
        'query_id',
        'user',
        'auth_date',
        'hash',
        'signature',
        'chat_instance',
        'chat_type',
        'start_param',
        'can_send_after',
        'receiver',
        'chat',
      ].includes(key) ||
      value.length > 4096
    )
      throw accessError('invalid_login');
    seen.add(key);
  }
  const hash = params.get('hash');
  if (!/^[a-fA-F0-9]{64}$/.test(hash || '')) throw accessError('invalid_login');
  const date = params.get('auth_date');
  if (!/^[0-9]{1,12}$/.test(date || '')) throw accessError('invalid_login');
  const age = Math.floor(now / 1000) - Number(date);
  if (age > maxAgeSeconds || age < -30) throw accessError('expired_login');
  const data = [...params]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex')))
    throw accessError('invalid_login');
  let user;
  try {
    user = JSON.parse(params.get('user'));
  } catch {
    throw accessError('invalid_login');
  }
  if (
    !user ||
    typeof user !== 'object' ||
    Array.isArray(user) ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    typeof user.first_name !== 'string' ||
    user.first_name.length > 256
  )
    throw accessError('invalid_login');
  return { telegramId: String(user.id) };
}
module.exports = { validateInitData };
