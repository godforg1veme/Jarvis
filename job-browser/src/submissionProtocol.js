const UNKNOWN = Object.freeze({ outcome: 'unknown' });
const ID = /^\d{1,20}$/;
const MAX_BODY = 65536;
function nativeId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : null;
}

function parseFields({ contentType, body }) {
  if (typeof contentType !== 'string' || !Buffer.isBuffer(body) || body.length > MAX_BODY) return null;
  const fields = new Map();
  const put = (name, bytes) => {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(name) || fields.has(name) || fields.size >= 40) throw Error();
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    fields.set(name, value);
  };
  try {
    if (/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(contentType)) {
      for (const [key, value] of new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(body))) put(key, Buffer.from(value));
    } else {
      const match = /^multipart\/form-data;\s*boundary=(?:"([\w'()+,./:=?-]{1,70})"|([\w'()+,./:=?-]{1,70}))$/i.exec(contentType);
      if (!match) return null;
      const boundary = `--${match[1] || match[2]}`;
      const parts = body.toString('latin1').split(boundary);
      if (parts.shift() !== '' || !['--\r\n', '--'].includes(parts.pop()) || parts.length > 40) return null;
      for (const part of parts) {
        const field = /^\r\nContent-Disposition: form-data; name="([a-zA-Z0-9_.-]{1,100})"\r\n\r\n([\s\S]*)\r\n$/i.exec(part);
        if (!field) return null;
        put(field[1], Buffer.from(field[2], 'latin1'));
      }
    }
    return fields;
  } catch { return null; }
}

function validateSubmissionRequest({ url, method, contentType, body }, { externalId, resumeId, letter }) {
  let target; try { target = new URL(url); } catch { return false; }
  if (method !== 'POST' || target.origin !== 'https://hh.ru' || target.username || target.password
    || target.pathname !== '/applicant/vacancy_response/popup' || target.search || target.hash
    || !ID.test(externalId || '') || !/^[a-zA-Z0-9]{1,100}$/.test(resumeId || '')
    || typeof letter !== 'string' || !letter.trim() || letter.length > 10000) return false;
  const fields = parseFields({ contentType, body });
  // FormData canonically encodes text line breaks as CRLF; no other whitespace is changed.
  if (!fields || fields.get('vacancy_id') !== externalId || fields.get('resume_hash') !== resumeId || fields.get('letter')?.replace(/\r\n/g, '\n') !== letter
    || fields.get('lux') !== 'true' || fields.get('ignore_postponed') !== 'true' || fields.get('withoutTest') !== 'yes'
    || !['true', 'false'].includes(fields.get('incomplete'))
    || fields.get('mark_applicant_visible_in_vacancy_country') !== 'false' || fields.get('country_ids') !== '[]') return false;
  const allowed = new Set(['vacancy_id', 'resume_hash', 'letter', 'lux', 'ignore_postponed', 'withoutTest',
    'incomplete', 'mark_applicant_visible_in_vacancy_country', 'country_ids', 'hhtmFromLabel', 'hhtmSourceLabel', '_xsrf']);
  return [...fields.keys()].every((key) => allowed.has(key) || /^captcha(?:_?[a-z][a-z0-9_]{0,40})?$/i.test(key));
}

function normalizeSubmissionReceipt(data, { resumeId, externalId }) {
  // Observed HH client consumes topic_id, chat_id and the new responseStatus.
  if (!data || !nativeId(data.topic_id) || !nativeId(data.chat_id) || !nativeId(externalId)) return UNKNOWN;
  const status = data.responseStatus;
  if (!status || !status.resumes || typeof status.resumes !== 'object' || Array.isArray(status.resumes)
    || Object.keys(status.resumes).length > 100 || !Array.isArray(status.usedResumeIds) || status.usedResumeIds.length > 100
    || !Array.isArray(status.negotiations?.topicList) || status.negotiations.topicList.length > 100) return UNKNOWN;
  const selected = Object.values(status.resumes).filter((resume) => resume?.hash === resumeId);
  if (selected.length !== 1 || !nativeId(selected[0].id)
    || !status.usedResumeIds.some((id) => nativeId(id) === nativeId(selected[0].id))
    || !status.negotiations.topicList.some((topic) => nativeId(topic?.resumeId) === nativeId(selected[0].id)
      && nativeId(topic?.chatId) === nativeId(data.chat_id) && nativeId(topic?.id) === nativeId(data.topic_id)
      && nativeId(topic?.vacancyId) === externalId)) return UNKNOWN;
  return { outcome: 'sent', verified: true, externalId: nativeId(data.topic_id) };
}

module.exports = { parseFields, validateSubmissionRequest, normalizeSubmissionReceipt, nativeId };
