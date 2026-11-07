const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCachedBuffer, inspectCachedResponseError, validPinnedRuntime } = require('../src/cachedResponseError');

test('cached 403 classification is closed and bounded before decoding', () => {
  assert.equal(classifyCachedBuffer(Buffer.from('XSRF rejected'), { 'content-type': 'text/plain' }), 'xsrf_rejected');
  assert.equal(classifyCachedBuffer(Buffer.from('CAPTCHA invalid'),
    { 'content-type': 'text/plain', 'content-encoding': 'gzip' }), 'captcha_rejected');
  assert.equal(classifyCachedBuffer(Buffer.alloc(32769), { 'content-type': 'text/plain' }), 'body_unavailable');
  assert.equal(classifyCachedBuffer(Buffer.from([0xff]), { 'content-type': 'text/plain' }), 'body_unavailable');
  assert.equal(classifyCachedBuffer(Buffer.from('XSRF rejected'),
    { 'content-type': 'application/octet-stream' }), 'body_unavailable');
  assert.equal(classifyCachedBuffer(Buffer.from('XSRF rejected'),
    { 'content-type': 'text/plain', 'content-encoding': 'unknown' }), 'body_unavailable');
});
test('unknown local Playwright bundle hash cannot inspect a response', () => {
  const sha = '9570b91312203319b0be44f50307553eaf9dafd78db381f0559d96dc59a0c320';
  assert.equal(validPinnedRuntime('1.64.0', sha, 'linux'), true);
  assert.equal(validPinnedRuntime('1.63.0', sha, 'linux'), false);
  assert.equal(validPinnedRuntime('1.64.0', '0'.repeat(64), 'linux'), false);
  assert.equal(validPinnedRuntime('1.64.0', sha, 'win32'), false);
  if (process.platform === 'linux') return;
  const response = { status: () => 403, body: () => assert.fail('no body call') };
  assert.equal(inspectCachedResponseError(response, {}), 'body_unavailable');
});
