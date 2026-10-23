// These literal codes are diagnostics only. The public broker error remains
// JOB_CAPTCHA_UNAVAILABLE; no website values or exception text cross the boundary.
const CODES = new Set([
  'JOB_CAPTCHA_PREPARATION_FAILED', 'JOB_CAPTCHA_OPEN_FAILED',
  'JOB_CAPTCHA_PICTURE_FAILED', 'JOB_CAPTCHA_PAGE_UNAVAILABLE',
  'JOB_CAPTCHA_FORM_UNAVAILABLE', 'JOB_CAPTCHA_PICTURE_MISSING',
  'JOB_CAPTCHA_PICTURE_AMBIGUOUS', 'JOB_CAPTCHA_PICTURE_ALREADY_USED',
  'JOB_CAPTCHA_PICTURE_INVALID', 'JOB_CAPTCHA_CHALLENGE_CHANGED',
  'JOB_CAPTCHA_VERIFY_READER_FAILED', 'JOB_CAPTCHA_VERIFY_HTTP_STATUS',
  'JOB_CAPTCHA_VERIFY_NAVIGATION_FAILED', 'JOB_CAPTCHA_VERIFY_DIFFERENT_LOCATION',
]);
function preparationCode(error) {
  return CODES.has(error?.failureCode) ? error.failureCode : 'JOB_CAPTCHA_PREPARATION_FAILED';
}
function preparationError(failureCode) {
  return Object.assign(new Error('JOB_CAPTCHA_UNAVAILABLE'), {
    code: 'JOB_CAPTCHA_UNAVAILABLE', failureCode: preparationCode({ failureCode }),
  });
}
function verificationFailure(reason, pictureFailure) {
  const codes = { reader_failed: 'JOB_CAPTCHA_VERIFY_READER_FAILED', http_status: 'JOB_CAPTCHA_VERIFY_HTTP_STATUS',
    navigation_failed: 'JOB_CAPTCHA_VERIFY_NAVIGATION_FAILED', different_location: 'JOB_CAPTCHA_VERIFY_DIFFERENT_LOCATION' };
  return Object.hasOwn(codes, reason) ? codes[reason] : preparationCode({ failureCode: pictureFailure });
}
module.exports = { preparationCode, preparationError, verificationFailure };
