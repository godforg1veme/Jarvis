const UNKNOWN = Object.freeze({ outcome: 'unknown' });
const { normalizeQuestionnaire, normalizeAnswers } = require('../../shared/jobQuestionnaire');
const ID = /^\d{1,20}$/;
const MAX_BODY = 65536;
function nativeId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : null;
}

function parseFields({ contentType, body, multipleNames = new Set() }) {
  if (typeof contentType !== 'string' || !Buffer.isBuffer(body) || body.length > MAX_BODY) return null;
  const fields = new Map();
  const put = (name, bytes) => {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(name) || fields.size >= 40) throw Error();
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (multipleNames.has(name)) {
      const existing = fields.get(name) || [];
      if (existing.length >= 20) throw Error();
      fields.set(name, [...existing, value]);
    } else {
      if (fields.has(name)) throw Error();
      fields.set(name, value);
    }
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

function validateSubmissionRequest({ url, method, contentType, body }, { externalId, resumeId, letter, questionnaire, answers, nativeStartTime }) {
  let target; try { target = new URL(url); } catch { return false; }
  if (method !== 'POST' || target.origin !== 'https://hh.ru' || target.username || target.password
    || target.pathname !== '/applicant/vacancy_response/popup' || target.search || target.hash
    || !ID.test(externalId || '') || !/^[a-zA-Z0-9]{1,100}$/.test(resumeId || '')
    || typeof letter !== 'string' || !letter.trim() || letter.length > 10000) return false;
  let canonical = null, selected = null;
  if ((questionnaire === undefined) !== (answers === undefined)) return false;
  if (questionnaire !== undefined) {
    try { canonical = normalizeQuestionnaire(questionnaire); selected = normalizeAnswers(canonical, answers); }
    catch { return false; }
  }
  const multipleNames = new Set(canonical?.questions.filter(question => question.type === 'multiple').map(question => question.id) || []);
  const fields = parseFields({ contentType, body, multipleNames });
  // FormData canonically encodes text line breaks as CRLF; no other whitespace is changed.
  if (!fields || fields.get('vacancy_id') !== externalId || fields.get('resume_hash') !== resumeId || fields.get('letter')?.replace(/\r\n/g, '\n') !== letter
    || fields.get('lux') !== 'true' || fields.get('ignore_postponed') !== 'true'
    || fields.get('withoutTest') !== 'no'
    || !['true', 'false'].includes(fields.get('incomplete'))
    || fields.get('mark_applicant_visible_in_vacancy_country') !== 'false' || fields.get('country_ids') !== '[]') return false;
  const allowed = new Set(['vacancy_id', 'resume_hash', 'letter', 'lux', 'ignore_postponed', 'withoutTest',
    'incomplete', 'mark_applicant_visible_in_vacancy_country', 'country_ids', 'hhtmFromLabel', 'hhtmSourceLabel', '_xsrf']);
  if (questionnaire !== undefined) {
    if (!canonical.native || typeof nativeStartTime !== 'string' || !nativeStartTime || nativeStartTime.length > 100
      || fields.get('uidPk') !== canonical.native.uidPk || fields.get('guid') !== canonical.native.guid
      || fields.get('testRequired') !== String(canonical.native.testRequired)
      || fields.get('startTime') !== nativeStartTime) return false;
    for (const name of ['uidPk', 'guid', 'testRequired', 'startTime']) allowed.add(name);
    for (const answer of selected) {
      const wireValue = fields.get(answer.id);
      if (allowed.has(answer.id) || (Array.isArray(answer.value)
        ? !Array.isArray(wireValue) || wireValue.length !== answer.value.length
          || wireValue.some(value => !answer.value.includes(value)) || new Set(wireValue).size !== wireValue.length
        : typeof wireValue !== 'string' || wireValue.replace(/\r\n/g, '\n') !== answer.value)) return false;
      allowed.add(answer.id);
    }
    if (canonical.questions.some((question) => !question.required && !selected.some(answer => answer.id === question.id)
      && fields.has(question.id))) return false;
  }
  return [...fields.keys()].every((key) => allowed.has(key) || /^captcha(?:_?[a-z][a-z0-9_]{0,40})?$/i.test(key));
}

function normalizeSubmissionReceipt(data, { resumeId, externalId }) {
  // Observed HH client consumes topic_id, chat_id and the new responseStatus.
  if (!data || data.requiredAdditionalData || !nativeId(data.topic_id) || !nativeId(data.chat_id) || !nativeId(externalId)) return UNKNOWN;
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
