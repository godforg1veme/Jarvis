const { parseFields } = require('./submissionProtocol');
const { xsrfCookieMatch } = require('./captchaResponse');
const ID = /^[a-zA-Z0-9]{1,100}$/;
const INTERVAL = 4 * 60 * 60 * 1000;
function validRaiseRequest(request, resumeId, cookie) {
  try {
    const u = new URL(request.url);
    if (!ID.test(resumeId) || request.method !== 'POST' || u.origin !== 'https://hh.ru'
      || u.pathname !== '/applicant/resumes/touch' || u.search || u.hash || u.username || u.password
      || !['xhr', 'fetch'].includes(request.resourceType) || !Buffer.isBuffer(request.body)
      || request.body.length > 20000 || xsrfCookieMatch(cookie, request.csrfToken) !== 'match') return false;
    const fields = parseFields(request);
    const names = ['resume', 'undirectable', 'fingerprintIteration2', 'fingerprintSp'];
    return Boolean(fields && fields.get('resume') === resumeId && fields.get('undirectable') === 'true'
      && fields.size >= 2 && fields.size <= 4 && [...fields.keys()].every(k => names.includes(k))
      && [...fields.values()].every(v => v.length <= 8192 && !/[\x00-\x1f\x7f]/u.test(v)));
  } catch { return false; }
}
module.exports = { validRaiseRequest, INTERVAL, ID };
