const { readBoundedJson } = require('./boundedHttp');
const { jobError } = require('./jobSchemas');
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const normalizedAnswer = text => typeof text === 'string' && text.length <= 200 ? text.trim().toLowerCase().replace(/\s+/gu, ' ') : '';
const validAnswer = text => /^[а-яё]{2,20} [а-яё]{2,20}$/u.test(text);
function pngBytes(value) {
  if (typeof value !== 'string' || value.length > 349528 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw jobError('JOB_CAPTCHA_UNAVAILABLE');
  const b = Buffer.from(value, 'base64');
  if (b.length < 24 || b.length > 262144 || b.toString('base64') !== value
    || !b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b.toString('ascii', 12, 16) !== 'IHDR'
    || b.readUInt32BE(16) < 1 || b.readUInt32BE(16) > 1024 || b.readUInt32BE(20) < 1 || b.readUInt32BE(20) > 256) throw jobError('JOB_CAPTCHA_UNAVAILABLE');
  return b;
}
class JobCaptchaClient {
  constructor({ ownerId, token, fetchImpl = globalThis.fetch, baseUrl = 'http://job-browser:8082/rpc', allowTestHttp = false }) {
    const u = new URL(baseUrl);
    if (!UUID.test(ownerId || '') || !/^[\x21-\x7e]{32,256}$/.test(token || '') || (u.href !== 'http://job-browser:8082/rpc'
      && !(allowTestHttp && u.origin.startsWith('http://127.0.0.1:') && u.pathname === '/rpc' && !u.search && !u.hash && !u.username && !u.password))) throw jobError('JOB_CAPTCHA_CONFIG_INVALID');
    Object.assign(this, { ownerId, token, fetchImpl, url: u.href });
  }
  async call(userId, operation, args) {
    if (!UUID.test(userId || '')) throw jobError('JOB_CAPTCHA_ACCESS_DENIED');
    let result;
    try {
      const response = await this.fetchImpl(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`,
        'x-jarvis-owner-id': this.ownerId, 'content-type': 'application/json' }, body: JSON.stringify({ userId, operation, args }),
        redirect: 'manual', signal: AbortSignal.timeout(operation === 'status' ? 5000 : 90000) });
      result = await readBoundedJson(response, 360000);
      if (!response.ok || !exact(result, ['ok', 'value']) || result.ok !== true) throw new Error();
    } catch { throw jobError('JOB_CAPTCHA_UNAVAILABLE'); }
    const v = result.value;
    if (operation === 'status' && exact(v, ['phase','revision']) && ['idle','pending','active','checking'].includes(v.phase) && Number.isSafeInteger(v.revision) && v.revision >= 0) return v;
    if (operation === 'challenge') {
      if (exact(v, ['outcome']) && ['idle','refresh_required','preparing'].includes(v.outcome)) return v;
      if (exact(v, ['outcome','challengeId','revision','pngBase64','expiresAt']) && v.outcome === 'ready' && UUID.test(v.challengeId || '')
        && Number.isSafeInteger(v.revision) && v.revision >= 0 && typeof v.expiresAt === 'string' && Number.isFinite(Date.parse(v.expiresAt)) && new Date(v.expiresAt).toISOString() === v.expiresAt
        && Date.parse(v.expiresAt) > Date.now() && Date.parse(v.expiresAt) <= Date.now() + 610000) return { ...v, png: pngBytes(v.pngBase64), pngBase64: undefined };
    }
    if (operation === 'answer' && exact(v, ['outcome']) && ['solved','new_challenge','unknown','stale','invalid','already_used'].includes(v.outcome)) return v;
    throw jobError('JOB_CAPTCHA_UNAVAILABLE');
  }
  status(userId = this.ownerId) { return this.call(userId, 'status', {}); }
  challenge(userId = this.ownerId, refresh = false) {
    if (typeof userId === 'boolean') { refresh = userId; userId = this.ownerId; }
    return this.call(userId, 'challenge', { refresh });
  }
  answer(input) { const { userId = this.ownerId, ...args } = input; return this.call(userId, 'answer', args); }
}
module.exports = { JobCaptchaClient, normalizedAnswer, validAnswer, pngBytes };
