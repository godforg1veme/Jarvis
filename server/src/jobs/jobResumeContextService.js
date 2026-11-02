const { assertJobScope, jobError } = require('./jobSchemas');

const ID = /^[a-zA-Z0-9]{1,100}$/;
const FIELDS = ['title', 'experience', 'skills', 'education', 'summary'];
const CACHE_TTL_MS = 60_000;
const MAX_CACHED_RESUMES = 32;
const privateContent = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?7|8)[\s(\-]*\d{3}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}|(?:телефон|e-?mail|адрес проживания|контактные данные)\s*[:：])/iu;
function resumeSnapshotSchema(value, resumeId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 7 || !FIELDS.every(key => Object.hasOwn(value, key))
    || !Object.hasOwn(value, 'resumeId') || !Object.hasOwn(value, 'grammaticalGender')
    || !ID.test(value.resumeId) || value.resumeId !== resumeId
    || !['male', 'female', 'unknown'].includes(value.grammaticalGender)) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
  for (const key of FIELDS) if (typeof value[key] !== 'string' || value[key].length > 12000 || privateContent.test(value[key]))
    throw jobError('JOB_HH_RESUME_UNAVAILABLE');
  if (!value.title.trim() || ![value.experience, value.skills, value.education, value.summary].some(s => s.trim())
    || JSON.stringify(value).length > 60000) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
  return value;
}

class JobResumeContextService {
  constructor({ pool, browserClient, accessService = null, now = () => Date.now() }) {
    Object.assign(this, { pool, browserClient, accessService, now });
    this.cache = new Map();
    this.inFlight = new Map();
  }
  async selected(scope, { allowDisconnected = false } = {}) {
    await assertJobScope(this.pool, scope, this.accessService);
    const row = (await this.pool.query('SELECT status,resume_id,revision FROM job_connections WHERE user_id=$1', [scope.userId])).rows[0];
    if (allowDisconnected && row?.status !== 'connected') return null;
    if (row?.status !== 'connected' || !ID.test(row.resume_id || '') || !Number.isInteger(row.revision))
      throw jobError('JOB_HH_RESUME_UNAVAILABLE');
    return row;
  }
  async assertCurrent({ scope, resumeId, connectionRevision }) {
    const row = await this.selected(scope);
    if (row.resume_id !== resumeId || row.revision !== connectionRevision) throw jobError('JOB_REVISION_CONFLICT');
  }
  async getSelected({ scope, requireComplete = false }) {
    const first = await this.selected(scope, { allowDisconnected: true });
    if (!first) return null;
    if (!this.browserClient) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
    const prefix = JSON.stringify([scope.userId, first.resume_id, first.revision]);
    const key = `${prefix}:${requireComplete ? 'complete' : 'partial'}`;
    const completeKey = `${prefix}:complete`;
    let snapshot;
    const now = this.now();
    const entry = [this.cache.get(key), !requireComplete && this.cache.get(completeKey)]
      .find(candidate => candidate && candidate.expiresAt > now);
    if (entry) snapshot = entry.snapshot;
    else {
      let pending = this.inFlight.get(key) || (!requireComplete && this.inFlight.get(completeKey));
      if (!pending) {
        pending = (async () => {
          const raw = await this.browserClient.forUser(scope.userId).readResume({ resumeId: first.resume_id,
            ...(requireComplete ? { requireComplete: true } : {}) });
          const validated = { ...resumeSnapshotSchema(raw, first.resume_id) };
          this.cache.delete(key);
          this.cache.set(key, { snapshot: validated, expiresAt: this.now() + CACHE_TTL_MS });
          while (this.cache.size > MAX_CACHED_RESUMES) this.cache.delete(this.cache.keys().next().value);
          return validated;
        })();
        this.inFlight.set(key, pending);
        pending.finally(() => { if (this.inFlight.get(key) === pending) this.inFlight.delete(key); }).catch(() => {});
      }
      snapshot = await pending;
    }
    await this.assertCurrent({ scope, resumeId: first.resume_id, connectionRevision: first.revision });
    return { resumeId: first.resume_id, connectionRevision: first.revision,
      snapshot: { ...snapshot } };
  }
}

module.exports = { JobResumeContextService, resumeSnapshotSchema };
