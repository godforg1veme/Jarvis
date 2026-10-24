const { assertJobScope, jobError } = require('./jobSchemas');

const ID = /^[a-zA-Z0-9]{1,100}$/;
const FIELDS = ['title', 'experience', 'skills', 'education', 'summary'];
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
  constructor({ pool, browserClient, accessService = null }) { Object.assign(this, { pool, browserClient, accessService }); }
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
  async getSelected({ scope }) {
    const first = await this.selected(scope, { allowDisconnected: true });
    if (!first) return null;
    if (!this.browserClient) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
    const raw = await this.browserClient.forUser(scope.userId).readResume({ resumeId: first.resume_id });
    await this.assertCurrent({ scope, resumeId: first.resume_id, connectionRevision: first.revision });
    return { resumeId: first.resume_id, connectionRevision: first.revision,
      snapshot: resumeSnapshotSchema(raw, first.resume_id) };
  }
}

module.exports = { JobResumeContextService, resumeSnapshotSchema };
