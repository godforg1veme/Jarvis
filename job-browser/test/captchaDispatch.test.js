const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchCaptcha } = require('../src/captchaDispatch');
test('captcha dispatch never follows or forwards redirects, including preserved-method 307/308', async () => {
  for (const status of [200, 302, 303, 307, 308, 403]) {
    let fulfilled, requests = 0;
    const route = { request: () => ({ url: () => 'https://hh.ru/account/captcha?backurl=%2Fvacancy%2F123&state=fixture' }),
      fetch: async (options) => { requests++; assert.equal(options.maxRedirects, 0); assert.equal(options.maxRetries, 0); assert.equal(options.timeout, 10000);
        return { status: () => status, headers: () => ({ location: 'https://evil.example/mutate' }) }; },
      fulfill: async (value) => { fulfilled = value; }, abort: async () => assert.fail('approved answer dispatch should reconcile by GET') };
    const result = await dispatchCaptcha(route); assert.equal(result.acknowledged, status === 200);
    assert.equal(result.httpStatus, status);
    assert.equal(result.redirectKind, status >= 300 && status < 400 ? 'external' : 'none');
    assert.equal(requests, 1); assert.equal(fulfilled.status, 204); assert.equal(fulfilled.headers.location, undefined);
  }
});
test('initialization accepts bounded JSON only and never returns a redirect to the browser', async () => {
  for (const status of [200, 307]) {
    let fulfilled = null, aborted = false;
    const route = { request: () => ({ url: () => 'https://hh.ru/captcha?lang=RU' }),
      fetch: async () => ({ status: () => status, headers: () => ({ 'content-type': 'application/json' }), body: async () => Buffer.from('{"key":"fixture"}') }),
      fulfill: async (value) => { fulfilled = value; }, abort: async () => { aborted = true; } };
    await dispatchCaptcha(route); assert.equal(aborted, status !== 200); assert.equal(Boolean(fulfilled), status === 200);
  }
});
test('403 reason is classified before disposal and raw HH error content is not forwarded', async () => {
  const bytes = Buffer.from('<h1>Forbidden: XSRF cookie does not match POST argument</h1>');
  let rendered;
  const route = { request: () => ({ url: () => 'https://hh.ru/account/captcha' }),
    fetch: async () => ({ status: () => 403, headers: () => ({ 'content-type': 'text/html', 'content-length': String(bytes.length) }), body: async () => bytes }),
    fulfill: async value => { rendered = value; } };
  const result = await dispatchCaptcha(route);
  assert.equal(result.httpStatus, 403); assert.equal(result.serverError, 'xsrf_rejected');
  assert.equal(result.acknowledged, false); assert.equal(rendered.status, 204); assert.equal(rendered.body, undefined);
});
