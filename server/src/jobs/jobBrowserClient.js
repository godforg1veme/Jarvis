const { jobError } = require('./jobSchemas');
const { readBoundedJson } = require('./boundedHttp');
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const CAPABILITIES = Object.freeze({ dateWindows: false, maxPages: 1000 });
const CODES = new Set(['JOB_HH_DOM_CHANGED', 'JOB_COLLECTION_WINDOW_SATURATED', 'JOB_COLLECTION_WINDOW_EXPIRED',
  'JOB_INVALID_SEARCH', 'JOB_INVALID_VACANCY', 'JOB_HH_CAPTCHA_REQUIRED', 'JOB_HH_RATE_LIMIT', 'JOB_HH_ACCESS_DENIED',
  'JOB_HH_LOGIN_REQUIRED', 'JOB_HH_NOT_FOUND', 'JOB_HH_UNAVAILABLE', 'JOB_HH_RESUME_UNAVAILABLE', 'JOB_BROWSER_ACCESS_DENIED',
  'JOB_BROWSER_INVALID_REQUEST', 'JOB_BROWSER_BUSY', 'JOB_BROWSER_REQUEST_TOO_LARGE', 'JOB_BROWSER_RESPONSE_TOO_LARGE']);

class JobBrowserClient {
  constructor({ baseUrl = 'http://job-browser:8080', ownerId, token, fetchImpl = globalThis.fetch, allowTestHttp = false }) {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.origin !== 'http://job-browser:8080' && !(allowTestHttp === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      || !UUID.test(ownerId || '') || typeof token !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(token)) throw jobError('JOB_BROWSER_CONFIG_INVALID');
    this.url = new URL('/rpc', url).href; this.ownerId = ownerId; this.token = token; this.fetch = fetchImpl;
  }
  forUser(userId) {
    if (userId !== this.ownerId) throw jobError('JOB_BROWSER_ACCESS_DENIED');
    return { capabilities: CAPABILITIES,
      search: ({ query, publishedFrom, publishedTo, page = 0 }) => this.request(userId, 'search', { query, publishedFrom, publishedTo, page }),
      getVacancy: ({ externalId }) => this.request(userId, 'vacancy', { externalId: String(externalId) }),
      listResumes: () => this.request(userId, 'resumes', {}),
      inspect: ({ externalId, resumeId }) => this.request(userId, 'inspect', { externalId: String(externalId), resumeId }),
    };
  }
  async request(userId, operation, args) {
    if (userId !== this.ownerId) throw jobError('JOB_BROWSER_ACCESS_DENIED');
    let response;
    try {
      response = await this.fetch(this.url, { method: 'POST', headers: {
        authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ userId, operation, args }), redirect: 'manual', signal: AbortSignal.timeout(45000) });
    } catch { throw jobError('JOB_HH_UNAVAILABLE'); }
    const result = await readBoundedJson(response);
    if (!response.ok || result?.ok !== true) throw jobError(CODES.has(result?.code) ? result.code : 'JOB_HH_UNAVAILABLE');
    const value = result.value;
    if (operation === 'search' && (!Array.isArray(value?.items) || value.items.length > 20
      || !Number.isInteger(value.pages) || value.pages < 0 || value.pages > 1000
      || !Number.isInteger(value.found) || value.found < 0 || !value.items.every((item) => /^\d{1,20}$/.test(item?.id || '')))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'vacancy' && (value?.externalId !== args.externalId || typeof value?.title !== 'string'
      || !Number.isFinite(Date.parse(value?.publishedAt)))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'resumes' && (!Array.isArray(value) || value.length > 20
      || !value.every((item) => /^[a-zA-Z0-9]{1,100}$/.test(item?.id || '') && typeof item.title === 'string' && item.title.length <= 500))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'inspect' && (value?.vacancy?.externalId !== args.externalId
      || typeof value.resumeAvailable !== 'boolean' || typeof value.manualRequired !== 'boolean')) throw jobError('JOB_HH_INVALID_RESPONSE');
    return value;
  }
}
module.exports = { JobBrowserClient };
