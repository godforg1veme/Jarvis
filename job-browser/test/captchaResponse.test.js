const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyErrorText, inspectResponseError, xsrfCookieMatch, MAX_ERROR_BYTES } = require('../src/captchaResponse');
const { validReceipt } = require('../src/captchaReceipt');
function response(body, headers = {}) {
  const bytes = Buffer.from(body);
  return { status: () => 403, headers: () => ({ 'content-type': 'text/html', 'content-length': String(bytes.length), ...headers }), body: async () => bytes };
}
test('HH failure inspection exports closed categories without response text or credentials', async () => {
  for (const [body, category] of [['<h1>Forbidden (_xsrf argument missing from POST)</h1>', 'xsrf_rejected'],
    ['{"error":"CAPTCHA_EXPIRED"}', 'captcha_expired'], ['{"error":"INVALID_CAPTCHA"}', 'captcha_rejected'],
    ['Origin not allowed', 'origin_rejected'], ['Too many requests', 'rate_limited'], ['Forbidden', 'forbidden_generic'],
    ['<script>invalid csrf private-token</script><p>Unrelated error</p>', 'unclassified']]) {
    assert.equal(await inspectResponseError(response(body)), category);
    assert.equal(classifyErrorText(body), category);
  }
});
test('unbounded, compressed, oversized and binary bodies are not read', async () => {
  for (const patch of [{ 'content-length': '' }, { 'content-length': String(MAX_ERROR_BYTES + 1) },
    { 'content-encoding': 'gzip' }, { 'content-type': 'application/octet-stream' }]) {
    const value = response('private', patch); value.body = () => assert.fail('body must not be read');
    assert.equal(await inspectResponseError(value), 'body_unavailable');
  }
  const value = response('small'); value.body = async () => Buffer.alloc(MAX_ERROR_BYTES + 1);
  assert.equal(await inspectResponseError(value), 'body_unavailable');
});
test('response reason is optional for legacy receipts and cannot contain arbitrary text', () => {
  const value = { operationHash: 'a'.repeat(64), startedAt: 0, stage: 'finished', received: true, permitted: 1,
    httpStatus: 403, redirect: 'none', verification: 'captcha', verificationStatus: 200, view: 'captcha', visibleError: 'none', outcome: 'unknown' };
  assert.ok(validReceipt(value)); assert.ok(validReceipt({ ...value, serverError: 'xsrf_rejected' }));
  assert.ok(!validReceipt({ ...value, serverError: 'private-token' }));
  assert.ok(validReceipt({ ...value, imageAgeMs: 999, pageAgeMs: null, requestKind: 'xhr', csrfCookieMatch: 'match' }));
  assert.ok(!validReceipt({ ...value, imageAgeMs: -1 }));
  assert.ok(!validReceipt({ ...value, pageAgeMs: 600001 }));
});
test('cookie comparison returns no cookie or token content and does not guess duplicate precedence', () => {
  assert.equal(xsrfCookieMatch('_xsrf=fixture; other=private', 'fixture'), 'match');
  assert.equal(xsrfCookieMatch('_xsrf=other', 'fixture'), 'mismatch');
  assert.equal(xsrfCookieMatch('_xsrf=fixture; _xsrf=other', 'fixture'), 'ambiguous');
  assert.equal(xsrfCookieMatch('other=private', 'fixture'), 'unavailable');
});
