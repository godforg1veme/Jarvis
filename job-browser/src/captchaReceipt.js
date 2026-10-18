const KEYS = ['operationHash', 'startedAt', 'stage', 'received', 'permitted', 'httpStatus', 'redirect',
  'verification', 'verificationStatus', 'view', 'visibleError', 'outcome'];
const { SERVER_ERRORS } = require('./captchaResponse');
const status = v => v === null || Number.isInteger(v) && v >= 100 && v <= 599;
const extras = v => v ? ['serverError', 'requestKind', 'imageAgeMs', 'pageAgeMs', 'csrfCookieMatch'].filter(k => Object.hasOwn(v, k)) : [];
function validExtras(v, extra) {
  const age = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 600000;
  return (!extra.includes('serverError') || SERVER_ERRORS.includes(v.serverError))
    && (!extra.includes('requestKind') || ['unobserved', 'xhr', 'form', 'other'].includes(v.requestKind))
    && (!extra.includes('csrfCookieMatch') || ['unavailable', 'ambiguous', 'match', 'mismatch'].includes(v.csrfCookieMatch))
    && (!extra.includes('imageAgeMs') || age(v.imageAgeMs)) && (!extra.includes('pageAgeMs') || age(v.pageAgeMs));
}
function validReceipt(v) {
  const extra = extras(v);
  return v && typeof v === 'object' && Object.keys(v).length === KEYS.length + extra.length && KEYS.every(k => Object.hasOwn(v, k))
    && validExtras(v, extra)
    && /^[a-f0-9]{64}$/.test(v.operationHash || '') && Number.isSafeInteger(v.startedAt) && v.startedAt >= 0
    && ['prepared', 'dispatching', 'response', 'finished'].includes(v.stage)
    && typeof v.received === 'boolean' && [0, 1].includes(v.permitted) && status(v.httpStatus) && status(v.verificationStatus)
    && ['none', 'captcha', 'same_origin', 'external', 'invalid'].includes(v.redirect)
    && ['not_checked', 'navigation_failed', 'http_status', 'captcha', 'different_location', 'reader_failed', 'verified'].includes(v.verification)
    && ['unavailable', 'captcha', 'other'].includes(v.view)
    && ['none', 'wrong_answer', 'expired', 'rate_limit', 'unavailable'].includes(v.visibleError)
    && ['pending', 'unknown', 'new_challenge', 'solved'].includes(v.outcome);
}
function validEvidenceReceipt(v) {
  const keys = ['received', 'permitted', 'httpStatus', 'verification'], extra = extras(v);
  return v && typeof v === 'object' && Object.keys(v).length === keys.length + extra.length && keys.every(k => Object.hasOwn(v, k))
    && validExtras(v, extra) && typeof v.received === 'boolean' && [0, 1].includes(v.permitted)
    && status(v.httpStatus) && ['captcha', 'verified', 'unconfirmed'].includes(v.verification);
}
function redirectKind(location, requestUrl) {
  if (!location) return 'none';
  try {
    const u = new URL(location, requestUrl);
    if (u.origin !== 'https://hh.ru' || u.username || u.password) return 'external';
    return u.pathname === '/account/captcha' ? 'captcha' : 'same_origin';
  } catch { return 'invalid'; }
}
module.exports = { validReceipt, validEvidenceReceipt, redirectKind };
