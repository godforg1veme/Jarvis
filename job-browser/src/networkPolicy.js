const ALLOWED = ['hh.ru', 'hhcdn.ru', 'yandex.ru', 'yastatic.net', 'yandexcloud.net',
  'google.com', 'gstatic.com', 'recaptcha.net', 'hcaptcha.com', 'challenges.cloudflare.com'];
function allowedRequest(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && ALLOWED.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
module.exports = { allowedRequest };
