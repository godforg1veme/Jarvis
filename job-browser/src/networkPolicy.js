const ALLOWED = ['hh.ru', 'hhcdn.ru', 'yandex.ru', 'yastatic.net', 'yandexcloud.net',
  'google.com', 'gstatic.com', 'recaptcha.net', 'hcaptcha.com', 'challenges.cloudflare.com'];
const HH_LOGIN_ORIGINS = new Set(['https://hh.ru', 'https://passport.hh.ru']);
const HH_LOGIN_PATHS = new Set(['/account/login', '/account/login/otp', '/account/login/password',
  '/account/login/phone', '/account/login/email', '/account/login/phone/confirm',
  '/account/login/email/confirm', '/auth/login', '/login']);
function allowedRequest(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && ALLOWED.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
function isApprovedHhLoginRequest(method, resourceType, value) {
  if (method !== 'POST' || !['document', 'xhr', 'fetch'].includes(resourceType)) return false;
  try {
    const url = new URL(value);
    return HH_LOGIN_ORIGINS.has(url.origin) && HH_LOGIN_PATHS.has(url.pathname)
      && !url.username && !url.password && !url.hash && (!url.port || url.port === '443');
  } catch { return false; }
}
module.exports = { allowedRequest, isApprovedHhLoginRequest, HH_LOGIN_ORIGINS, HH_LOGIN_PATHS };
