const { parseFields } = require('./submissionProtocol');
const { xsrfCookieMatch } = require('./captchaResponse');

const RESPONSE_CLASSES = new Set(['small_text', 'missing_length', 'invalid_length', 'oversize',
  'encoded', 'unsupported_type', 'body_unavailable']);
const ERROR_CLASSES = new Set(['not_inspected', 'body_unavailable', 'unclassified',
  'forbidden_generic', 'xsrf_rejected', 'origin_rejected', 'captcha_expired',
  'captcha_rejected', 'rate_limited']);
const TOKEN_CLASSES = new Set(['missing', 'present', 'duplicate', 'invalid_form', 'unavailable']);
const HEADER_CLASSES = new Set(['missing', 'present', 'unavailable']);
const MATCH_CLASSES = new Set(['match', 'mismatch', 'ambiguous', 'unavailable']);
const ORIGIN_CLASSES = new Set(['hh', 'other', 'missing', 'invalid']);

function responseClass(headers) {
  const length = headers?.['content-length'];
  if (!/^(?:identity)?$/i.test(headers?.['content-encoding'] || '')) return 'encoded';
  if (length == null || length === '') return 'missing_length';
  if (!/^[1-9]\d{0,9}$/.test(length)) return 'invalid_length';
  if (Number(length) > 32768) return 'oversize';
  if (!/^(?:application\/(?:json|problem\+json)|text\/(?:html|plain))(?:;|$)/i.test(headers?.['content-type'] || '')) return 'unsupported_type';
  return 'small_text';
}
function originClass(value) {
  if (value == null || value === '') return 'missing';
  if (typeof value !== 'string' || value.length > 8192) return 'invalid';
  try { const url = new URL(value); return url.origin === 'https://hh.ru' ? 'hh' : 'other'; }
  catch { return 'invalid'; }
}
function requestDiagnostic(request, observedHeaders = null) {
  try {
    const headers = observedHeaders || request.headers();
    const body = request.postDataBuffer();
    const fields = parseFields({ contentType: headers['content-type'], body });
    const token = fields?.get('_xsrf');
    let xsrf = !fields ? 'invalid_form' : token === undefined ? 'missing' : 'present';
    if (!fields && Buffer.isBuffer(body) && body.length <= 65536
      && /^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(headers['content-type'] || '')) {
      try { if (new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(body)).getAll('_xsrf').length > 1)
        xsrf = 'duplicate'; } catch {}
    }
    const headerToken = headers['x-xsrftoken'];
    const xsrfHeader = headerToken === undefined ? 'missing' : typeof headerToken === 'string' ? 'present' : 'unavailable';
    return { xsrf, xsrfCookie: xsrf === 'present' ? xsrfCookieMatch(headers.cookie, token) : 'unavailable',
      xsrfHeader, xsrfHeaderBody: xsrf === 'present' && xsrfHeader === 'present'
        ? (headerToken === token ? 'match' : 'mismatch') : 'unavailable',
      xsrfHeaderCookie: xsrfHeader === 'present' ? xsrfCookieMatch(headers.cookie, headerToken) : 'unavailable',
      origin: originClass(headers.origin), referer: originClass(headers.referer) };
  } catch { return { xsrf: 'unavailable', xsrfCookie: 'unavailable', xsrfHeader: 'unavailable',
    xsrfHeaderBody: 'unavailable', xsrfHeaderCookie: 'unavailable', origin: 'invalid', referer: 'invalid' }; }
}
function validSubmissionDiagnostic(value) {
  const keys = value && Object.keys(value).sort().join(',');
  const legacy = keys === 'errorClass,origin,referer,responseClass,status,xsrf,xsrfCookie,xsrfHeader,xsrfHeaderBody';
  const current = keys === 'errorClass,origin,referer,responseClass,status,xsrf,xsrfCookie,xsrfHeader,xsrfHeaderBody,xsrfHeaderCookie';
  return (legacy || current)
    && value.status === 403 && RESPONSE_CLASSES.has(value.responseClass)
    && ERROR_CLASSES.has(value.errorClass) && TOKEN_CLASSES.has(value.xsrf)
    && MATCH_CLASSES.has(value.xsrfCookie) && HEADER_CLASSES.has(value.xsrfHeader)
    && MATCH_CLASSES.has(value.xsrfHeaderBody)
    && (legacy || MATCH_CLASSES.has(value.xsrfHeaderCookie))
    && ORIGIN_CLASSES.has(value.origin)
    && ORIGIN_CLASSES.has(value.referer);
}
module.exports = { responseClass, requestDiagnostic, validSubmissionDiagnostic };
