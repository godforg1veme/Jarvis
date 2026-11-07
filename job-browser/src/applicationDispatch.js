const { validateSubmissionRequest } = require('./submissionProtocol');
const { readSubmissionReceipt } = require('./submissionReceipt');
const { requestDiagnostic, validSubmissionDiagnostic } = require('./submissionDiagnostic');

// Fetch the validated request exactly once outside Chromium's response-body cache.
// Never forward upstream redirects to the page: they could repeat a POST.
async function dispatchApplication(route, input) {
  const request = route.request();
  if (!validateSubmissionRequest({ url: request.url(), method: request.method(),
    contentType: request.headers()['content-type'], body: request.postDataBuffer() }, input)) {
    await route.abort().catch(() => {});
    return { outcome: 'manual_required', verified: true, reasonCode: 'JOB_HH_SUBMISSION_BLOCKED' };
  }
  let response, result;
  try {
    response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
    result = await readSubmissionReceipt(response, input);
    if (result?.submissionDiagnostic) {
      try {
        // Playwright request.headers() can omit security headers such as Cookie.
        // Read them only to derive enums; raw values never leave this frame.
        let observedHeaders;
        try { observedHeaders = typeof request.allHeaders === 'function' ? await request.allHeaders() : request.headers(); }
        catch { observedHeaders = request.headers(); }
        const diagnostic = { ...result.submissionDiagnostic, ...requestDiagnostic(request, observedHeaders) };
        if (validSubmissionDiagnostic(diagnostic)) result = { ...result, submissionDiagnostic: diagnostic };
        else result = { outcome: result.outcome, reasonCode: result.reasonCode };
      } catch { result = { outcome: result.outcome, reasonCode: result.reasonCode }; }
    }
  } catch { result = { outcome: 'unknown', reasonCode: 'JOB_HH_RECEIPT_TRANSPORT_FAILED' }; }
  finally {
    // The synthetic response is never used as proof. Only the original API response is.
    await route.fulfill({ status: 204, headers: { 'cache-control': 'no-store' } }).catch(() => route.abort().catch(() => {}));
    await response?.dispose?.().catch(() => {});
  }
  return result;
}

module.exports = { dispatchApplication };
