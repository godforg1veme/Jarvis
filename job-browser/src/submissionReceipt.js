const { normalizeSubmissionReceipt } = require('./submissionProtocol');
const { inspectResponseError } = require('./captchaResponse');
const { responseClass } = require('./submissionDiagnostic');
const { inspectCachedResponseError } = require('./cachedResponseError');

const unknown = (reasonCode) => ({ outcome: 'unknown', reasonCode });

async function httpFailure(response, status, headers, inspectedError = null) {
  if ([301,302,303,307,308].includes(status)) {
    try {
      const u = new URL(headers.location, 'https://hh.ru');
      if (typeof headers.location === 'string' && headers.location.length <= 8192
        && u.origin === 'https://hh.ru' && !u.username && !u.password) {
        if (['/account/captcha','/captcha'].includes(u.pathname)) return unknown('JOB_HH_RECEIPT_CAPTCHA');
        if (u.pathname === '/account/login') return unknown('JOB_HH_RECEIPT_AUTH_REQUIRED');
      }
    } catch {}
    return unknown('JOB_HH_RECEIPT_REDIRECT');
  }
  if (status === 401) return unknown('JOB_HH_RECEIPT_AUTH_REQUIRED');
  if (status === 429) return unknown('JOB_HH_RECEIPT_RATE_LIMITED');
  if ([400,403,422].includes(status)) {
    const reason = inspectedError || await inspectResponseError(response);
    if (reason === 'xsrf_rejected') return unknown('JOB_HH_RECEIPT_XSRF_REJECTED');
    if (reason === 'origin_rejected') return unknown('JOB_HH_RECEIPT_ORIGIN_REJECTED');
    if (['captcha_expired','captcha_rejected'].includes(reason)) return unknown('JOB_HH_RECEIPT_CAPTCHA');
    if (reason === 'rate_limited') return unknown('JOB_HH_RECEIPT_RATE_LIMITED');
  }
  if (status === 403) return unknown('JOB_HH_RECEIPT_FORBIDDEN');
  if (status >= 500 && status <= 599) return unknown('JOB_HH_RECEIPT_SERVER_ERROR');
  if (status >= 400 && status <= 499) return unknown('JOB_HH_RECEIPT_CLIENT_ERROR');
  return unknown('JOB_HH_RECEIPT_HTTP');
}

async function readSubmissionReceipt(response, input, nativeRequest = null) {
  let status, headers;
  try { status = response.status(); headers = response.headers(); }
  catch { return unknown('JOB_HH_RECEIPT_META_FAILED'); }
  if (status < 200 || status >= 300) {
    let errorClass = status === 403 ? await inspectResponseError(response) : null;
    if (status === 403 && errorClass === 'body_unavailable' && nativeRequest)
      errorClass = inspectCachedResponseError(response, nativeRequest);
    const result = await httpFailure(response, status, headers, errorClass);
    if (status !== 403) return result;
    try {
      const cls = responseClass(headers);
      return { ...result, submissionDiagnostic: { status: 403, responseClass: cls,
        errorClass, xsrf: 'unavailable', xsrfCookie: 'unavailable', xsrfHeader: 'unavailable',
        xsrfHeaderBody: 'unavailable', xsrfHeaderCookie: 'unavailable', origin: 'missing', referer: 'missing' } };
    } catch { return result; }
  }
  if (!/^application\/json(?:;|$)/i.test(headers['content-type'] || '')
    || Number(headers['content-length'] || 0) > 1048576) return unknown('JOB_HH_RECEIPT_FORMAT');
  let bytes;
  try { bytes = await response.body(); }
  catch { return unknown('JOB_HH_RECEIPT_BODY_FAILED'); }
  if (bytes.length > 1048576) return unknown('JOB_HH_RECEIPT_FORMAT');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return unknown('JOB_HH_RECEIPT_FORMAT'); }
  try {
    const result = normalizeSubmissionReceipt(value, input);
    return result.outcome === 'unknown' ? unknown('JOB_HH_RECEIPT_SCHEMA') : result;
  } catch { return unknown('JOB_HH_RECEIPT_READ_FAILED'); }
}

// Chromium fallback for fixture/custom dispatchers. Start before click completes.
function captureSubmissionReceipt({ page, request, timeoutMs, input }) {
  return page.waitForResponse((response) => request() !== null && response.request() === request(),
    { timeout: timeoutMs }).then(response => readSubmissionReceipt(response, input)).catch((error) => unknown(error?.name === 'TimeoutError'
    ? 'JOB_HH_RECEIPT_TIMEOUT' : 'JOB_HH_RECEIPT_READ_FAILED'));
}

module.exports = { captureSubmissionReceipt, readSubmissionReceipt };
