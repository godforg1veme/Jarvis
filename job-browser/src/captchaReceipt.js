const KEYS = ['operationHash', 'startedAt', 'stage', 'received', 'permitted', 'httpStatus', 'redirect',
  'verification', 'verificationStatus', 'view', 'visibleError', 'outcome'];
const status = v => v === null || Number.isInteger(v) && v >= 100 && v <= 599;
function validReceipt(v) {
  return v && typeof v === 'object' && Object.keys(v).length === KEYS.length && KEYS.every(k => Object.hasOwn(v, k))
    && /^[a-f0-9]{64}$/.test(v.operationHash || '') && Number.isSafeInteger(v.startedAt) && v.startedAt >= 0
    && ['prepared', 'dispatching', 'response', 'finished'].includes(v.stage)
    && typeof v.received === 'boolean' && [0, 1].includes(v.permitted) && status(v.httpStatus) && status(v.verificationStatus)
    && ['none', 'captcha', 'same_origin', 'external', 'invalid'].includes(v.redirect)
    && ['not_checked', 'navigation_failed', 'http_status', 'captcha', 'different_location', 'reader_failed', 'verified'].includes(v.verification)
    && ['unavailable', 'captcha', 'other'].includes(v.view)
    && ['none', 'wrong_answer', 'expired', 'rate_limit', 'unavailable'].includes(v.visibleError)
    && ['pending', 'unknown', 'new_challenge', 'solved'].includes(v.outcome);
}
function redirectKind(location, requestUrl) {
  if (!location) return 'none';
  try {
    const u = new URL(location, requestUrl);
    if (u.origin !== 'https://hh.ru' || u.username || u.password) return 'external';
    return u.pathname === '/account/captcha' ? 'captcha' : 'same_origin';
  } catch { return 'invalid'; }
}
module.exports = { validReceipt, redirectKind };
