const test = require('node:test');
const assert = require('node:assert/strict');
const { responseClass, requestDiagnostic, validSubmissionDiagnostic } = require('../src/submissionDiagnostic');
const { dispatchApplication } = require('../src/applicationDispatch');

const input = { externalId: '123', resumeId: 'fixture', letter: 'Approved fixture' };
function request(headers = {}, bodyPatch = {}) {
  const body = new URLSearchParams({ vacancy_id: '123', resume_hash: 'fixture', letter: input.letter,
    lux: 'true', ignore_postponed: 'true', withoutTest: 'no', incomplete: 'false',
    mark_applicant_visible_in_vacancy_country: 'false', country_ids: '[]', ...bodyPatch });
  return { url: () => 'https://hh.ru/applicant/vacancy_response/popup', method: () => 'POST',
    headers: () => ({ 'content-type': 'application/x-www-form-urlencoded', ...headers }),
    postDataBuffer: () => Buffer.from(body.toString()) };
}
test('closed response metadata never reads an unbounded or encoded body', () => {
  assert.equal(responseClass({}), 'missing_length');
  assert.equal(responseClass({ 'content-encoding': 'gzip' }), 'encoded');
  assert.equal(responseClass({ 'content-length': '999999' }), 'oversize');
  assert.equal(responseClass({ 'content-length': 'nope' }), 'invalid_length');
  assert.equal(responseClass({ 'content-length': '10', 'content-type': 'application/octet-stream' }), 'unsupported_type');
});
test('request diagnostic exposes categories only', () => {
  assert.deepEqual(requestDiagnostic(request({ origin: 'https://hh.ru', referer: 'https://hh.ru/secret?token=private',
    cookie: '_xsrf=secret; other=private', 'x-xsrftoken': 'secret' }, { _xsrf: 'secret' })),
  { xsrf: 'present', xsrfCookie: 'match', xsrfHeader: 'present', xsrfHeaderBody: 'match',
    xsrfHeaderCookie: 'match', origin: 'hh', referer: 'hh' });
  assert.deepEqual(requestDiagnostic(request()),
  { xsrf: 'missing', xsrfCookie: 'unavailable', xsrfHeader: 'missing', xsrfHeaderBody: 'unavailable',
    xsrfHeaderCookie: 'unavailable',
    origin: 'missing', referer: 'missing' });
  for (const [cookie, expected] of [['_xsrf=secret', 'match'], ['_xsrf=other', 'mismatch'],
    ['_xsrf=secret; _xsrf=other', 'ambiguous']]) {
    const native = request({ cookie, 'x-xsrftoken': 'secret' });
    const diagnostic = requestDiagnostic(native);
    assert.equal(diagnostic.xsrf, 'missing');
    assert.equal(diagnostic.xsrfCookie, 'unavailable');
    assert.equal(diagnostic.xsrfHeaderBody, 'unavailable');
    assert.equal(diagnostic.xsrfHeaderCookie, expected);
  }
  assert.equal(requestDiagnostic(request({}, { _xsrf: 'private' })).xsrfHeaderBody, 'unavailable');
  const duplicate = request(); duplicate.postDataBuffer = () => Buffer.from(`${duplicateBody()}&_xsrf=second`);
  assert.equal(requestDiagnostic(duplicate).xsrf, 'duplicate');
  const invalid = request(); invalid.postDataBuffer = () => Buffer.from('bad=one&bad=two');
  assert.equal(requestDiagnostic(invalid).xsrf, 'invalid_form');
  assert.equal(validSubmissionDiagnostic({ status: 403, responseClass: 'small_text', errorClass: 'forbidden_generic',
    xsrf: 'present', xsrfCookie: 'match', xsrfHeader: 'present', xsrfHeaderBody: 'match',
    xsrfHeaderCookie: 'match', origin: 'hh', referer: 'hh', raw: 'private' }), false);
  const legacy = { status: 403, responseClass: 'small_text', errorClass: 'forbidden_generic',
    xsrf: 'missing', xsrfCookie: 'unavailable', xsrfHeader: 'present', xsrfHeaderBody: 'unavailable',
    origin: 'hh', referer: 'hh' };
  assert.equal(validSubmissionDiagnostic(legacy), true);
  assert.equal(validSubmissionDiagnostic({ ...legacy, xsrfHeaderCookie: 'match' }), true);
  assert.equal(validSubmissionDiagnostic({ ...legacy, xsrfHeaderCookie: 'unexpected' }), false);
});
function duplicateBody() { return '_xsrf=first'; }
test('one original POST yields closed 403 diagnostic without changing unknown result', async () => {
  let fetches = 0, bodyReads = 0;
  const original = request({ origin: 'https://hh.ru', referer: 'https://hh.ru/private' }, { _xsrf: 'secret' });
  original.allHeaders = async () => ({ ...original.headers(), cookie: '_xsrf=secret', 'x-xsrftoken': 'secret' });
  const result = await dispatchApplication({ request: () => original,
    fetch: async options => { fetches++; assert.deepEqual(options, { maxRedirects: 0, maxRetries: 0, timeout: 15000 });
      return { status: () => 403, headers: () => ({ 'content-encoding': 'gzip' }),
        body: async () => { bodyReads++; throw Error('must not read'); }, dispose: async () => {} }; },
    fulfill: async ({ status }) => assert.equal(status, 204), abort: async () => {} }, input);
  assert.equal(fetches, 1); assert.equal(bodyReads, 0);
  assert.equal(result.outcome, 'unknown'); assert.equal(result.reasonCode, 'JOB_HH_RECEIPT_FORBIDDEN');
  assert.deepEqual(result.submissionDiagnostic, { status: 403, responseClass: 'encoded', errorClass: 'body_unavailable',
    xsrf: 'present', xsrfCookie: 'match', xsrfHeader: 'present', xsrfHeaderBody: 'match',
    xsrfHeaderCookie: 'match',
    origin: 'hh', referer: 'hh' });
  assert.ok(!JSON.stringify(result).includes('secret'));
});
