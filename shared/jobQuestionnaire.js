const { createHash } = require('node:crypto');

const ID = /^[A-Za-z0-9_.-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const RESERVED_FIELDS = new Set(['vacancy_id', 'resume_hash', 'letter', 'lux', 'ignore_postponed',
  'withoutTest', 'incomplete', 'mark_applicant_visible_in_vacancy_country', 'country_ids',
  'hhtmFromLabel', 'hhtmSourceLabel', '_xsrf']);
const STOP_REASONS = new Set(['JOB_HH_QUESTIONS_REQUIRED', 'JOB_HH_TEST_REQUIRED',
  'JOB_HH_EXTERNAL_ACTION', 'JOB_HH_FORM_CHANGED', 'JOB_HH_RESUME_HIDDEN',
  'JOB_HH_RESUME_UNAVAILABLE', 'JOB_HH_CAPTCHA_REQUIRED', 'JOB_HH_SUBMISSION_BLOCKED',
  'JOB_HH_PRIVACY_DENIED', 'JOB_HH_ALREADY_APPLIED', 'JOB_HH_LETTER_TOO_LONG',
  'JOB_HH_LETTER_CHANGED', 'JOB_HH_NOT_FOUND', 'JOB_HH_PREPARATION_FAILED']);
const UNKNOWN_RESULT_REASONS = new Set(['JOB_HH_RECEIPT_TIMEOUT', 'JOB_HH_RECEIPT_HTTP',
  'JOB_HH_RECEIPT_FORMAT', 'JOB_HH_RECEIPT_SCHEMA', 'JOB_HH_RECEIPT_READ_FAILED',
  'JOB_HH_RECEIPT_BODY_FAILED', 'JOB_HH_RECEIPT_META_FAILED']);
const fail = (code) => Object.assign(new Error(code), { code });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const cleanText = (value, limit) => typeof value === 'string'
  && value.trim().length > 0 && value.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)
  ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim() : null;

function normalizeQuestionnaire(value) {
  if (!value || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 20
    || !['hash,questions', 'questions', 'hash,native,questions', 'native,questions'].includes(Object.keys(value).sort().join(',')))
    throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
  const rawNative = value.native;
  if (rawNative !== undefined && (!exact(rawNative, ['uidPk', 'guid', 'testRequired'])
    || typeof rawNative.uidPk !== 'string' || !/^[1-9]\d{0,19}$/.test(rawNative.uidPk)
    || typeof rawNative.guid !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(rawNative.guid)
    || typeof rawNative.testRequired !== 'boolean')) throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
  const native = rawNative === undefined ? undefined
    : { uidPk: rawNative.uidPk, guid: rawNative.guid, testRequired: rawNative.testRequired };
  const ids = new Set();
  const questions = value.questions.map((question) => {
    if (!exact(question, ['id', 'label', 'type', 'required', 'maxLength', 'options']) || !ID.test(question.id)
      || (native && !/^task_[1-9]\d{0,19}(?:_text)?$/.test(question.id))
      || RESERVED_FIELDS.has(question.id) || /^captcha/i.test(question.id)
      || ids.has(question.id) || !['text', 'single', 'multiple'].includes(question.type)
      || typeof question.required !== 'boolean') throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
    ids.add(question.id);
    const label = cleanText(question.label, 1000);
    if (!label || !Array.isArray(question.options) || question.options.length > 20)
      throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
    let options;
    if (question.type === 'text') {
      if (question.options.length !== 0 || !Number.isInteger(question.maxLength)
        || question.maxLength < 1 || question.maxLength > 2000) throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
      options = [];
    } else {
      if (question.maxLength !== null || question.options.length < 2)
        throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
      const optionIds = new Set();
      options = question.options.map((option) => {
        if (!exact(option, ['id', 'label']) || !ID.test(option.id) || optionIds.has(option.id))
          throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
        optionIds.add(option.id);
        const optionLabel = cleanText(option.label, 1000);
        if (!optionLabel) throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
        return { id: option.id, label: optionLabel };
      });
    }
    return { id: question.id, label, type: question.type, required: question.required,
      maxLength: question.maxLength, options };
  });
  const source = JSON.stringify(native ? { native, questions } : questions);
  if (Buffer.byteLength(source, 'utf8') > 32768) throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
  const hash = createHash('sha256').update(source).digest('hex');
  if (Object.hasOwn(value, 'hash') && (!HASH.test(value.hash) || value.hash !== hash))
    throw fail('JOB_HH_INVALID_QUESTIONNAIRE');
  return { hash, ...(native ? { native } : {}), questions };
}

function normalizeAnswers(questionnaire, value) {
  const canonical = normalizeQuestionnaire(questionnaire);
  if (!Array.isArray(value) || value.length > canonical.questions.length)
    throw fail('JOB_HH_INVALID_ANSWERS');
  const byId = new Map();
  for (const answer of value) {
    if (!exact(answer, ['id', 'value']) || !ID.test(answer.id) || byId.has(answer.id))
      throw fail('JOB_HH_INVALID_ANSWERS');
    byId.set(answer.id, answer.value);
  }
  let total = 0;
  const answers = [];
  for (const question of canonical.questions) {
    const raw = byId.get(question.id);
    if (raw === undefined) {
      if (question.required) throw fail('JOB_HH_INVALID_ANSWERS');
      continue;
    }
    let answerValue;
    if (question.type === 'text') {
      if (typeof raw !== 'string') throw fail('JOB_HH_INVALID_ANSWERS');
      answerValue = raw.trim();
      if (!answerValue || answerValue.length > question.maxLength || answerValue.length > 2000
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(answerValue)) throw fail('JOB_HH_INVALID_ANSWERS');
    } else if (question.type === 'single') {
      if (!question.options.some((option) => option.id === raw)) throw fail('JOB_HH_INVALID_ANSWERS');
      answerValue = raw;
    } else {
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > question.options.length
        || raw.some(id => typeof id !== 'string' || !question.options.some(option => option.id === id))
        || new Set(raw).size !== raw.length) throw fail('JOB_HH_INVALID_ANSWERS');
      answerValue = question.options.filter(option => raw.includes(option.id)).map(option => option.id);
    }
    total += Array.isArray(answerValue) ? answerValue.reduce((sum, id) => sum + id.length, 0) : answerValue.length;
    if (total > 16000) throw fail('JOB_HH_INVALID_ANSWERS');
    answers.push({ id: question.id, value: answerValue });
  }
  if (byId.size !== answers.length) throw fail('JOB_HH_INVALID_ANSWERS');
  return answers;
}

module.exports = { normalizeQuestionnaire, normalizeAnswers, STOP_REASONS, UNKNOWN_RESULT_REASONS };
