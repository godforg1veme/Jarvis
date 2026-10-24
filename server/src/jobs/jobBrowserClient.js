const { jobError } = require('./jobSchemas');
const { readBoundedJson } = require('./boundedHttp');
const { historySchema, itemSchema } = require('./jobHistorySchema');
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const CAPABILITIES = Object.freeze({ dateWindows: true, dateWindowGranularity: 'moscow_day', maxPages: 1000 });
function validInputFields(fields, width, height) {
  const keys = ['x', 'y', 'width', 'height', 'type', 'inputMode', 'multiline'];
  return Array.isArray(fields) && fields.length <= 20 && fields.every((field) =>
    field && typeof field === 'object' && !Array.isArray(field)
    && Object.keys(field).length === keys.length && keys.every((key) => Object.hasOwn(field, key))
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(field[key]))
    && field.x >= 0 && field.y >= 0 && field.width >= 4 && field.height >= 4
    && field.x + field.width <= width && field.y + field.height <= height
    && ['text', 'password', 'email', 'tel', 'number', 'search', 'url'].includes(field.type)
    && ['text', 'numeric', 'decimal', 'tel', 'email', 'url', 'search'].includes(field.inputMode)
    && typeof field.multiline === 'boolean');
}
const CODES = new Set(['JOB_HH_MANUAL_ACTIVE', 'JOB_HH_CAPTCHA_WAITING', 'JOB_HH_CAPTCHA_MANUAL_REQUIRED', 'JOB_HH_DOM_CHANGED', 'JOB_COLLECTION_WINDOW_SATURATED', 'JOB_COLLECTION_WINDOW_EXPIRED',
  'JOB_INVALID_SEARCH', 'JOB_INVALID_VACANCY', 'JOB_HH_CAPTCHA_REQUIRED', 'JOB_HH_RATE_LIMIT', 'JOB_HH_ACCESS_DENIED',
  'JOB_HH_LOGIN_REQUIRED', 'JOB_HH_NOT_FOUND', 'JOB_HH_UNAVAILABLE', 'JOB_HH_RESUME_UNAVAILABLE', 'JOB_BROWSER_ACCESS_DENIED',
  'JOB_BROWSER_INVALID_REQUEST', 'JOB_BROWSER_BUSY', 'JOB_BROWSER_REQUEST_TOO_LARGE', 'JOB_BROWSER_RESPONSE_TOO_LARGE',
  'JOB_LOGIN_SESSION_INVALID', 'JOB_LOGIN_TICKET_INVALID', 'JOB_LOGIN_RESUME_INVALID']);

class JobBrowserClient {
  constructor({ baseUrl = 'http://job-browser:8080', ownerId, token, connectToken = null, resumeToken = null, applyToken = null, fetchImpl = globalThis.fetch, allowTestHttp = false }) {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.origin !== 'http://job-browser:8080' && !(allowTestHttp === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      || !UUID.test(ownerId || '') || typeof token !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(token)) throw jobError('JOB_BROWSER_CONFIG_INVALID');
    if (applyToken !== null && (typeof applyToken !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(applyToken)
      || applyToken === token)) throw jobError('JOB_BROWSER_CONFIG_INVALID');
    if (connectToken !== null && (typeof connectToken !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(connectToken)
      || connectToken === token || connectToken === applyToken)) throw jobError('JOB_BROWSER_CONFIG_INVALID');
    this.url = new URL('/rpc', url).href; this.ownerId = ownerId; this.token = token;
    if (resumeToken !== null && (!/^[\x21-\x7e]{32,256}$/.test(resumeToken) || [token,connectToken,applyToken].includes(resumeToken))) throw jobError('JOB_BROWSER_CONFIG_INVALID');
    this.resumeToken = resumeToken;
    this.connectToken = connectToken; this.applyToken = applyToken; this.fetch = fetchImpl;
  }
  asApplicationAdapter() {
    return { capabilities: { applicantApply: Boolean(this.applyToken) },
      inspect: ({ userId, externalId, resumeId }) => this.request(userId, 'inspect', { externalId: String(externalId), resumeId }),
      submit: ({ userId, ...args }) => this.request(userId, 'submit', args),
      reconcile: ({ userId, ...args }) => this.request(userId, 'reconcile', args) };
  }
  connection(userId) { return this.request(userId, 'connection', {}); }
  forUser(userId) {
    if (!UUID.test(userId || '')) throw jobError('JOB_BROWSER_ACCESS_DENIED');
    return { capabilities: CAPABILITIES,
      search: ({ query, publishedFrom, publishedTo, page = 0 }) => this.request(userId, 'search', { query, publishedFrom, publishedTo, page }),
      getVacancy: ({ externalId }) => this.request(userId, 'vacancy', { externalId: String(externalId) }),
      listResumes: () => this.request(userId, 'resumes', {}),
      readResume: ({ resumeId }) => this.request(userId, 'resume_content', { resumeId }),
      connection: () => this.request(userId, 'connection', {}),
      raiseResume: ({ operationId, resumeId }) => this.request(userId, 'raise_resume', { operationId, resumeId }),
      resumeRaiseStatus: ({ operationId, resumeId }) => this.request(userId, 'raise_resume_status', { operationId, resumeId }),
      history: ({section,page}) => this.request(userId, 'history', {section,page}),
      inspect: ({ externalId, resumeId }) => this.request(userId, 'inspect', { externalId: String(externalId), resumeId }),
      startLogin: ({ sessionId }) => this.request(userId, 'login_start', { sessionId }),
      loginFrame: ({ sessionId }) => this.request(userId, 'login_frame', { sessionId }),
      loginInput: ({ sessionId, sequence, event }) => this.request(userId, 'login_input', { sessionId, sequence, event }),
      loginStatus: ({ sessionId }) => this.request(userId, 'login_status', { sessionId }),
      closeLogin: ({ sessionId, preserveProfile = false, complete = false }) => this.request(userId, 'login_close', { sessionId, preserveProfile, complete }),
      discardLogin: ({ sessionId }) => this.request(userId, 'login_discard', { sessionId }),
      selectResume: ({ resumeId }) => this.request(userId, 'select_resume', { resumeId }),
    };
  }
  async request(userId, operation, args) {
    if (!UUID.test(userId || '')) throw jobError('JOB_BROWSER_ACCESS_DENIED');
    const writing = ['submit', 'reconcile'].includes(operation);
    const raising = ['raise_resume','raise_resume_status'].includes(operation);
    if (raising && !this.resumeToken) throw jobError('JOB_BROWSER_ACCESS_DENIED');
    if (writing && !this.applyToken) throw jobError('JOB_BROWSER_ACCESS_DENIED');
    const connecting = ['login_start', 'login_frame', 'login_input', 'login_status', 'login_close', 'login_discard', 'select_resume'].includes(operation);
    if (connecting && !this.connectToken) throw jobError('JOB_BROWSER_ACCESS_DENIED');
    let response;
    try {
      response = await this.fetch(this.url, { method: 'POST', headers: {
        authorization: `Bearer ${raising ? this.resumeToken : writing ? this.applyToken : connecting ? this.connectToken : this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ userId, operation, args }), redirect: 'manual', signal: AbortSignal.timeout(writing ? 120000 : 90000) });
    } catch { throw jobError('JOB_HH_UNAVAILABLE'); }
    const result = await readBoundedJson(response);
    if (!response.ok || result?.ok !== true) {
      const error = jobError(CODES.has(result?.code) ? result.code : 'JOB_HH_UNAVAILABLE');
      if (error.code === 'JOB_HH_CAPTCHA_WAITING') {
        if (!Number.isInteger(result.retryAfterMs) || result.retryAfterMs < 1000 || result.retryAfterMs > 120000) throw jobError('JOB_HH_UNAVAILABLE');
        error.retryAfterMs = result.retryAfterMs;
      }
      if (error.code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' && UUID.test(result.recoveryId || '')) error.recoveryId = result.recoveryId;
      throw error;
    }
    const value = result.value;
    if (raising) {
      if (!value || !['raised','not_due','ineligible','failed','unknown'].includes(value.outcome)
        || (value.outcome !== 'unknown' && value.verified !== true)
        || value.nextAllowedAt !== undefined && !Number.isFinite(Date.parse(value.nextAllowedAt))) throw jobError('JOB_HH_INVALID_RESPONSE');
      return { outcome:value.outcome, ...(value.verified === true ? {verified:true} : {}),
        ...(value.nextAllowedAt ? {nextAllowedAt:new Date(value.nextAllowedAt).toISOString()} : {}) };
    }
    if (operation === 'login_frame' && (!value || !['waiting','captcha'].includes(value.state)
      || value.mimeType !== 'image/jpeg' || !Number.isInteger(value.width) || value.width < 1 || value.width > 1024
      || !Number.isInteger(value.height) || value.height < 1 || value.height > 768
      || typeof value.frameBase64 !== 'string' || value.frameBase64.length > 700000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.frameBase64)
      || Buffer.from(value.frameBase64, 'base64').length > 512 * 1024)) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'login_frame') {
      if (Object.hasOwn(value, 'inputFields') && !validInputFields(value.inputFields, value.width, value.height))
        throw jobError('JOB_HH_INVALID_RESPONSE');
      // The remote page is untrusted. Only frame bytes and closed keyboard hints
      // cross into the guest client; never echo arbitrary DOM or field values.
      return { state: value.state, mimeType: value.mimeType, frameBase64: value.frameBase64,
        width: value.width, height: value.height,
        ...(Object.hasOwn(value, 'inputFields') ? { inputFields: value.inputFields } : {}) };
    }
    if (operation === 'login_input' && (!value || !['waiting','authenticated','captcha','expired','closed'].includes(value.state)
      || !Number.isSafeInteger(value.nextSequence) || value.nextSequence < 1 || value.nextSequence > 1000000000)) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'login_status' && (!value || !['waiting','authenticated','captcha','expired','closed'].includes(value.state)
      || !Number.isSafeInteger(value.nextSequence) || value.nextSequence < 1 || value.nextSequence > 1000000000
      || !Array.isArray(value.resumes) || value.resumes.length > 20
      || !value.resumes.every((item) => /^[a-zA-Z0-9]{1,100}$/.test(item?.id || '') && typeof item.title === 'string' && item.title.length <= 500))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (['login_start','login_close','login_discard','select_resume'].includes(operation) && (!value || value.ok !== true)) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'history') {
      const parsed = historySchema.safeParse(value);
      if (!parsed.success || value.page !== args.page || value.section !== args.section) throw jobError('JOB_HH_INVALID_RESPONSE');
      return parsed.data;
    }
    if (operation === 'connection' && (!/^[a-zA-Z0-9]{1,100}$/.test(value?.resumeId || '')
      || typeof value?.title !== 'string' || !value.title.trim() || value.title.length > 500)) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (writing && (!value || !['unknown', 'sent', 'failed', 'manual_required', 'already_applied'].includes(value.outcome)
      || (value.outcome !== 'unknown' && value.verified !== true)
      || (value.outcome === 'sent' && !/^[1-9]\d{0,19}$/.test(value.externalId || '')))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'search' && (!Array.isArray(value?.items) || value.items.length > 20
      || !Number.isInteger(value.pages) || value.pages < 0 || value.pages > 50000
      || !Number.isInteger(value.found) || value.found < 0 || value.found > 1000000
      || value.pages !== Math.ceil(value.found / 20)
      || !value.items.every((item) => /^\d{1,20}$/.test(item?.id || '')))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'vacancy' && (value?.externalId !== args.externalId || typeof value?.title !== 'string'
      || !Number.isFinite(Date.parse(value?.publishedAt)))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'resumes' && (!Array.isArray(value) || value.length > 20
      || !value.every((item) => /^[a-zA-Z0-9]{1,100}$/.test(item?.id || '') && typeof item.title === 'string' && item.title.length <= 500))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if (operation === 'resumes') return value.map(item=>({id:item.id,title:item.title,...(typeof item.canRaise==='boolean'?{canRaise:item.canRaise}:{})}));
    if (operation === 'resume_content') {
      const { resumeSnapshotSchema } = require('./jobResumeContextService');
      return resumeSnapshotSchema(value, args.resumeId);
    }
    if (operation === 'inspect' && (!value || typeof value.resumeAvailable !== 'boolean' || typeof value.manualRequired !== 'boolean'
      || (value.vacancy?.externalId !== args.externalId && !(value.resumeAvailable === false && value.manualRequired === true && value.vacancy === null)))) throw jobError('JOB_HH_INVALID_RESPONSE');
    if(operation==='inspect'&&value.existingApplication){
      const known=itemSchema.safeParse(value.existingApplication);
      if(!known.success||known.data.vacancyId!==args.externalId||known.data.resumeHash!==args.resumeId||known.data.topicId!==value.existingApplicationId)throw jobError('JOB_HH_INVALID_RESPONSE');
    }
    return value;
  }
}
module.exports = { JobBrowserClient };
