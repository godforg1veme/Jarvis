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
const decisionSchema = z.object({ decision: z.enum(['apply', 'skip']), directionMatched: z.boolean(),
  reasonCode: z.enum(reasonCodes), rationale: z.string().trim().min(1).max(240) }).strict().superRefine((value, ctx) => {
  if ((value.decision === 'apply') !== (value.directionMatched && value.reasonCode === 'DIRECTION_FIT')
    || (!value.directionMatched && value.reasonCode !== 'OUT_OF_DIRECTION'))
    ctx.addIssue({ code: 'custom', message: 'Inconsistent direction decision' });
});

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
    searchSettings: settings, filterPolicy: FILTER_POLICY, filterResult, matchAnnotations,
  };
}

function buildVacancyPrompt(input) {
  return [{ role: 'system', content: instructions },
    { role: 'user', content: JSON.stringify(buildSelectionContext(input)) }];
}

function parseVacancyDecision(text, finishReason) {
  if (finishReason !== 'stop' || typeof text !== 'string' || text.length > 1000) throw jobError('JOB_MODEL_INVALID_OUTPUT');
  try { return decisionSchema.parse(JSON.parse(text)); }
  catch { throw jobError('JOB_MODEL_INVALID_OUTPUT'); }
}

module.exports = { buildSelectionContext, buildVacancyPrompt, parseVacancyDecision };
