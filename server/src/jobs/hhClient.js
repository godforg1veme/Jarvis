const { jobError } = require('./jobSchemas');
const { readBoundedJson, safeTestBase } = require('./boundedHttp');

function normalizeHhVacancy(raw) {
  if (!raw || !/^\d{1,20}$/.test(String(raw.id)) || typeof raw.name !== 'string'
    || !Number.isFinite(Date.parse(raw.published_at))) throw jobError('JOB_HH_INVALID_VACANCY');
  const formats = (raw.work_format || []).map((x) => x.id);
  let workFormat = formats.includes('REMOTE') || raw.schedule?.id === 'remote' ? 'remote'
    : formats.includes('HYBRID') ? 'hybrid' : formats.includes('ON_SITE') ? 'office' : 'unknown';
  return { externalId: String(raw.id), title: raw.name.slice(0, 500),
    company: String(raw.employer?.name || '').slice(0, 500),
    description: String(raw.description || '').slice(0, 100000),
    city: String(raw.address?.city || raw.area?.name || '').slice(0, 200), workFormat,
    remoteRestriction: 'unknown', salary: raw.salary || null,
    employment: String(raw.employment_form?.name || raw.employment?.name || '').slice(0, 150),
    url: `https://hh.ru/vacancy/${raw.id}`,
    publishedAt: new Date(raw.published_at).toISOString(), archived: raw.archived === true,
    manualRequired: Boolean(raw.response_url || raw.has_test || raw.type?.id === 'direct'),
    experience: String(raw.experience?.name || '').slice(0, 150),
  };
}

class HhClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl, allowTestHttp = false, userAgent, timeoutMs = 20000, readCredential = null } = {}) {
    this.baseUrl = safeTestBase(baseUrl, 'https://api.hh.ru/', allowTestHttp);
    this.fetch = fetchImpl; this.userAgent = userAgent || 'JarvisJobSearch/1.0'; this.timeoutMs = timeoutMs;
    this.readCredential = readCredential;
  }
  async request(path, { method = 'GET', credential, body, query } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) if (value != null) url.searchParams.set(key, String(value));
    const headers = { 'HH-User-Agent': this.userAgent, Accept: 'application/json' };
    if (credential || (method === 'GET' && this.readCredential)) headers.Authorization = `Bearer ${credential || this.readCredential}`;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let response;
    try {
      response = await this.fetch(url, { method, headers, body: body ? new URLSearchParams(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'manual' });
    } catch { throw jobError(method === 'GET' ? 'JOB_HH_UNAVAILABLE' : 'JOB_HH_OUTCOME_UNKNOWN'); }
    if (!response.ok) {
      await response.body?.cancel();
      const code = response.status === 429 ? 'JOB_HH_RATE_LIMIT' : response.status === 401 || response.status === 403
        ? 'JOB_HH_ACCESS_DENIED' : response.status === 404 ? 'JOB_HH_NOT_FOUND' : response.status >= 500
          ? (method === 'GET' ? 'JOB_HH_UNAVAILABLE' : 'JOB_HH_OUTCOME_UNKNOWN')
          : response.status >= 300 && response.status < 400 ? 'JOB_HH_MANUAL_REQUIRED' : 'JOB_HH_REJECTED';
      const error = jobError(code);
      const retry = Number(response.headers.get('retry-after'));
      error.retryAfterMs = Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 86400000) : 60000;
      throw error;
    }
    if (response.status === 204) return {};
    try { return await readBoundedJson(response); }
    catch (error) {
      if (method !== 'GET') throw jobError('JOB_HH_OUTCOME_UNKNOWN');
      throw error;
    }
  }
  async search({ query, publishedFrom, publishedTo, page = 0 }) {
    if (typeof query !== 'string' || query.length > 200 || !Number.isInteger(page) || page < 0 || page > 19
      || !Number.isFinite(Date.parse(publishedFrom)) || !Number.isFinite(Date.parse(publishedTo))) throw jobError('JOB_INVALID_SEARCH');
    const result = await this.request('/vacancies', { query: { text: query, date_from: publishedFrom,
      date_to: publishedTo, page, per_page: 100, order_by: 'publication_time' } });
    if (!Array.isArray(result.items) || !Number.isInteger(result.pages) || !Number.isFinite(result.found)) throw jobError('JOB_HH_INVALID_RESPONSE');
    return result;
  }
  async getVacancy({ externalId, credential }) {
    if (!/^\d{1,20}$/.test(String(externalId))) throw jobError('JOB_INVALID_VACANCY');
    return normalizeHhVacancy(await this.request(`/vacancies/${externalId}`, { credential }));
  }
}

module.exports = { HhClient, normalizeHhVacancy };
