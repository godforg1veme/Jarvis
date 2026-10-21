const { validInit } = require('./captchaProtocol');
const { dispatchCaptcha } = require('./captchaDispatch');

// HH's login modal loads a picture automatically, then retries the original
// login callback with the human's answer. Only picture creation needs a new
// write permission; account actions retain the existing gesture guard.
async function handleLoginCaptcha(route, { page, active }) {
  const request = route.request();
  let url;
  try { url = new URL(request.url()); } catch { return false; }
  if (url.pathname !== '/captcha' || request.method() !== 'POST') return false;
  let permitted = false;
  try {
    const current = new URL(page.url());
    permitted = active && request.frame() === page.mainFrame()
      && ['xhr', 'fetch'].includes(request.resourceType())
      && current.origin === 'https://hh.ru'
      && (current.pathname === '/account/login' || current.pathname.startsWith('/account/login/')
        || current.pathname === '/account/captcha')
      && validInit({ url: request.url(), method: request.method(),
        contentType: request.headers()['content-type'], body: request.postDataBuffer() });
  } catch {}
  if (permitted) await dispatchCaptcha(route);
  else await route.abort();
  return true;
}
module.exports = { handleLoginCaptcha };
