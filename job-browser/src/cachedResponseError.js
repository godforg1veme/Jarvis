const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { classifyErrorText } = require('./captchaResponse');

const MAX_BYTES = 32768;
const PINNED_VERSION = '1.64.0';
const PINNED_LINUX_BUNDLE_SHA256 = '9570b91312203319b0be44f50307553eaf9dafd78db381f0559d96dc59a0c320';
const CLOSED = new Set(['xsrf_rejected', 'origin_rejected', 'captcha_expired',
  'captcha_rejected', 'rate_limited', 'forbidden_generic', 'unclassified']);
let verifiedPin;
function validPinnedRuntime(version, bundleSha256, platform) {
  return platform === 'linux' && version === PINNED_VERSION && bundleSha256 === PINNED_LINUX_BUNDLE_SHA256;
}

function pinnedBundleVerified() {
  if (verifiedPin !== undefined) return verifiedPin;
  try {
    const packagePath = require.resolve('playwright-core/package.json');
    const version = require(packagePath).version;
    const bundle = path.join(path.dirname(packagePath), 'lib', 'coreBundle.js');
    verifiedPin = validPinnedRuntime(version,
      createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'), process.platform);
  } catch { verifiedPin = false; }
  return verifiedPin;
}

function classifyCachedBuffer(buffer, headers) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_BYTES) return 'body_unavailable';
    if (!/^(?:application\/(?:json|problem\+json)|text\/(?:html|plain))(?:;|$)/i.test(headers?.['content-type'] || ''))
      return 'body_unavailable';
    if (!/^(?:identity|gzip|br|deflate)?$/i.test(headers?.['content-encoding'] || '')) return 'body_unavailable';
    // Playwright's server has already buffered the original response. Do not
    // decompress, copy, or call APIResponse.body() for an unbounded RPC result.
    const category = classifyErrorText(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    return CLOSED.has(category) ? category : 'body_unavailable';
  } catch { return 'body_unavailable'; }
}

function inspectCachedResponseError(response, nativeRequest) {
  try {
    if (!pinnedBundleVerified() || response.status() !== 403 || !nativeRequest) return 'body_unavailable';
    const context = nativeRequest.frame().page().context();
    if (!context || response._request !== context.request || response.url() !== nativeRequest.url())
      return 'body_unavailable';
    const owner = response._request;
    if (typeof owner._connection?.toImpl !== 'function') return 'body_unavailable';
    const impl = owner._connection.toImpl(owner);
    if (!(impl?.fetchResponses instanceof Map)) return 'body_unavailable';
    const uid = response._initializer?.fetchUid;
    if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128) return 'body_unavailable';
    return classifyCachedBuffer(impl.fetchResponses.get(uid), response.headers());
  } catch { return 'body_unavailable'; }
}

module.exports = { inspectCachedResponseError, classifyCachedBuffer, validPinnedRuntime };
