const MAX_ERROR_BYTES = 32768;
const SERVER_ERRORS = ['not_inspected', 'not_applicable', 'body_unavailable', 'unclassified',
  'xsrf_rejected', 'origin_rejected', 'captcha_expired', 'captcha_rejected', 'rate_limited', 'forbidden_generic'];
function classifyErrorText(text) {
  // Return literal categories only; never retain website text or exception messages.
  const value = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').toLowerCase();
  if (/(?:xsrf|csrf)/.test(value) && /missing|mismatch|does not match|not match|invalid|reject|fail|невер|отсутств/.test(value)) return 'xsrf_rejected';
  if (/(?:origin|referer)/.test(value) && /invalid|reject|mismatch|not allowed|forbidden/.test(value)) return 'origin_rejected';
  if (/too many requests|rate[_ -]?limit|слишком много запрос/.test(value)) return 'rate_limited';
  if (/captcha.{0,80}(?:expir|timeout)|(?:expir|timeout).{0,80}captcha|капч.{0,40}ист[её]к/.test(value)) return 'captcha_expired';
  if (/captcha.{0,80}(?:wrong|incorrect|invalid|reject)|(?:wrong|incorrect|invalid).{0,80}captcha|неверн.{0,40}(?:капч|символ)/.test(value)) return 'captcha_rejected';
  if (/forbidden|access denied/.test(value)) return 'forbidden_generic';
  return 'unclassified';
}
async function inspectResponseError(response) {
  try {
    if (response.status() < 400) return 'not_applicable';
    if (response.status() === 429) return 'rate_limited';
    const h = response.headers(), length = h['content-length'];
    // APIResponse already owns the fetched body. Inspect only a declared small,
    // uncompressed text response; do not request arbitrary/streaming payloads.
    if (!/^[1-9]\d{0,4}$/.test(length || '') || Number(length) > MAX_ERROR_BYTES
      || !/^(?:identity)?$/i.test(h['content-encoding'] || '')
      || !/^(?:application\/(?:json|problem\+json)|text\/(?:html|plain))(?:;|$)/i.test(h['content-type'] || '')) return 'body_unavailable';
    const bytes = await response.body();
    if (!Buffer.isBuffer(bytes) || bytes.length !== Number(length) || bytes.length > MAX_ERROR_BYTES) return 'body_unavailable';
    return classifyErrorText(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return 'body_unavailable'; }
}
function xsrfCookieMatch(cookie, token) {
  if (typeof cookie !== 'string' || cookie.length > 32768 || typeof token !== 'string' || !token) return 'unavailable';
  const values = cookie.split(';').map(v => v.trim()).filter(v => v.startsWith('_xsrf=')).map(v => v.slice(6));
  if (!values.length) return 'unavailable';
  if (values.length !== 1) return 'ambiguous';
  try { return values[0] === token || decodeURIComponent(values[0]) === token ? 'match' : 'mismatch'; }
  catch { return 'unavailable'; }
}
module.exports = { inspectResponseError, classifyErrorText, xsrfCookieMatch, SERVER_ERRORS, MAX_ERROR_BYTES };
