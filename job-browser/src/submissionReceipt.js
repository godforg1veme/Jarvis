const { normalizeSubmissionReceipt } = require('./submissionProtocol');

const unknown = (reasonCode) => ({ outcome: 'unknown', reasonCode });

async function readSubmissionReceipt(response, input) {
  let status, headers;
  try { status = response.status(); headers = response.headers(); }
  catch { return unknown('JOB_HH_RECEIPT_META_FAILED'); }
  if (status < 200 || status >= 300) return unknown('JOB_HH_RECEIPT_HTTP');
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
