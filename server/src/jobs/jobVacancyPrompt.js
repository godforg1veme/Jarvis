const { z } = require('zod');
const { profileSchema, jobError } = require('./jobSchemas');
const { resumeSnapshotSchema } = require('./jobResumeContextService');
const { loadInstruction } = require('../prompts/instructionFiles');

const instructions = loadInstruction('job-selection');
const FILTER_POLICY = Object.freeze({
  exclusions: 'Explicit exclusions are hard substring exclusions in title and description.',
  location: 'remote=true permits remote work as well as office/hybrid work compatible with officeCity; remote=false excludes known remote jobs. Unknown work format or city stays uncertain. A foreign-only remote restriction is excluded.',
  salary: 'targetRub is a net monthly search target. Reject only proven below-target pay. Unknown tax status, period, bonuses, currency rate, conflicting ranges or missing salary need clarification, not rejection. A range reaching the target can remain eligible even if its minimum is lower.',
  uncertainty: 'include=true with annotations is eligible for further direction/experience evaluation. An annotation alone is not proof of a hard condition violation.',
  collection: 'intervalMs/historyDays/paused/activated/budgetUsd govern collection and API use; they are not promises to an employer.',
});
const reasonCodes = ['DIRECTION_FIT', 'OUT_OF_DIRECTION', 'INSUFFICIENT_FIT',
  'MANDATORY_REQUIREMENT', 'USER_CONSTRAINT', 'UNCERTAIN'];
const assessmentSchema = z.object({
  primaryOccupation: z.string().trim().min(1).max(120),
  targetQuery: z.string().max(200).nullable(),
  relationship: z.enum(['core', 'tool_only', 'adjacent', 'unclear']),
  dutiesQuotes: z.array(z.string().max(240)).max(3),
}).strict();
const decisionSchema = z.object({ decision: z.enum(['apply', 'skip']), directionMatched: z.boolean(),
  reasonCode: z.enum(reasonCodes), rationale: z.string().trim().min(1).max(240),
  directionAssessment: assessmentSchema }).strict();
const normalizeText = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru');
function collectDutyEvidence(description, limit) {
  if (typeof description !== 'string') return [];
  const evidence = [];
  const seen = new Set();
  const add = clean => {
    if (clean.length < 10 || seen.has(clean)) return;
    evidence.push(clean); seen.add(clean);
  };
  for (const part of description.split(/(?<=[.!?;])\s+|[\r\n]+|[•●▪]+/u)) {
    let remaining = part.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    while (remaining && evidence.length < limit) {
      if (remaining.length <= 240) { add(remaining); break; }
      let end = remaining.lastIndexOf(' ', 240);
      if (end < 10) {
        end = 240;
        // Do not cut a UTF-16 surrogate pair when a long word has no spaces.
        if (/[\uD800-\uDBFF]/u.test(remaining[end - 1])
          && /[\uDC00-\uDFFF]/u.test(remaining[end])) end--;
      }
      add(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trimStart();
    }
    if (evidence.length === limit) break;
  }
  return evidence;
}
function buildDutyEvidenceContext(description) {
  // The validated vacancy is bounded; sample across the whole description so
  // a long company introduction cannot hide duties at its end.
  const fragments = collectDutyEvidence(description, 16384);
  const complete = fragments.length <= 96;
  const candidates = complete ? fragments : Array.from({ length: 96 }, (_, index) =>
    fragments[Math.floor(index * (fragments.length - 1) / 95)]);
  return { dutyEvidence: candidates, dutyEvidenceComplete: complete };
}
function buildDutyEvidence(description) { return buildDutyEvidenceContext(description).dutyEvidence; }
function knownSkip(assessment, reasonCode) {
  return { decision: 'skip', directionMatched: false, reasonCode,
    rationale: reasonCode === 'OUT_OF_DIRECTION'
      ? 'Основные обязанности не совпадают с выбранным направлением работы.'
      : 'Недостаточно проверенных обязанностей для подтверждения целевого направления.',
    directionAssessment: assessment };
}

function enforceVacancyDirection(decision, { vacancy, settings } = {}) {
  let parsed;
  try {
    parsed = decisionSchema.parse(decision);
  } catch { throw jobError('JOB_MODEL_INVALID_OUTPUT'); }
  const assessment = parsed.directionAssessment;
  const description = normalizeText(typeof vacancy?.description === 'string' ? vacancy.description : '');
  const meaningfulQuotes = assessment.dutiesQuotes.filter(quote => normalizeText(quote).length >= 10);
  const validQuotes = meaningfulQuotes.filter(quote => description.includes(normalizeText(quote)));
  const normalized = { ...assessment, dutiesQuotes: validQuotes };
  if (assessment.relationship === 'tool_only' || assessment.relationship === 'adjacent')
    return knownSkip(normalized, 'OUT_OF_DIRECTION');
  if (assessment.relationship !== 'core' || typeof assessment.targetQuery !== 'string'
    || !assessment.targetQuery.trim() || !Array.isArray(settings?.queries)
    || !settings.queries.includes(assessment.targetQuery) || !validQuotes.length
    || validQuotes.length !== meaningfulQuotes.length)
    return knownSkip({ ...normalized, relationship: 'unclear' }, 'UNCERTAIN');
  if (parsed.decision === 'apply' && parsed.directionMatched && parsed.reasonCode === 'DIRECTION_FIT')
    return { ...parsed, directionAssessment: normalized };
  if (parsed.decision === 'skip' && parsed.directionMatched
    && ['INSUFFICIENT_FIT', 'MANDATORY_REQUIREMENT', 'USER_CONSTRAINT', 'UNCERTAIN'].includes(parsed.reasonCode))
    return { ...parsed, directionAssessment: normalized };
  return knownSkip({ ...normalized, relationship: 'unclear' }, 'UNCERTAIN');
}

function buildSelectionContext({ vacancy, profile, resumeContext, settings = {}, filterResult = null,
  matchAnnotations = [] }) {
  const personal = profileSchema.parse(profile);
  if (!resumeContext) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
  const selectedResume = resumeSnapshotSchema(resumeContext.snapshot, resumeContext.resumeId);
  if (!vacancy || typeof vacancy.title !== 'string' || typeof vacancy.description !== 'string'
    || JSON.stringify(vacancy).length > 131072) throw jobError('JOB_INVALID_VACANCY');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || JSON.stringify(settings).length > 32768 || !Array.isArray(matchAnnotations)
    || matchAnnotations.length > 50 || matchAnnotations.some(x => typeof x !== 'string' || x.length > 100)
    || (filterResult && (typeof filterResult.include !== 'boolean'
      || !Array.isArray(filterResult.reasonCodes) || !Array.isArray(filterResult.annotations))))
    throw jobError('JOB_INVALID_VACANCY');
  return {
    vacancy, selectedResume, facts: personal.facts, baseLetter: personal.baseLetter,
    searchSettings: settings, ...buildDutyEvidenceContext(vacancy.description),
    filterPolicy: FILTER_POLICY, filterResult, matchAnnotations,
  };
}

function buildVacancyPrompt(input) {
  return [{ role: 'system', content: instructions },
    { role: 'user', content: JSON.stringify(buildSelectionContext(input)) }];
}

function parseVacancyDecision(text, finishReason, input) {
  // Valid bounded Unicode fields may be encoded as six-character JSON escapes.
  if (finishReason !== 'stop' || typeof text !== 'string' || text.length > 12000) throw jobError('JOB_MODEL_INVALID_OUTPUT');
  try { return enforceVacancyDirection(JSON.parse(text), input); }
  catch { throw jobError('JOB_MODEL_INVALID_OUTPUT'); }
}

module.exports = { buildSelectionContext, buildVacancyPrompt, parseVacancyDecision,
  enforceVacancyDirection, buildDutyEvidence, buildDutyEvidenceContext };
