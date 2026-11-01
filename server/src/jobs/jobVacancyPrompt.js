const { z } = require('zod');
const { profileSchema, jobError } = require('./jobSchemas');
const { resumeSnapshotSchema } = require('./jobResumeContextService');
const { loadInstruction } = require('../prompts/instructionFiles');

const instructions = loadInstruction('job-selection');
const decisionSchema = z.object({ decision: z.enum(['apply', 'skip']) }).strict();

function buildVacancyPrompt({ vacancy, profile, resumeContext, settings = {} }) {
  const personal = profileSchema.parse(profile);
  if (!resumeContext) throw jobError('JOB_HH_RESUME_UNAVAILABLE');
  const selectedResume = resumeSnapshotSchema(resumeContext.snapshot, resumeContext.resumeId);
  if (!vacancy || typeof vacancy.title !== 'string' || typeof vacancy.description !== 'string'
    || JSON.stringify(vacancy).length > 131072) throw jobError('JOB_INVALID_VACANCY');
  return [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify({
    vacancy: { title: vacancy.title, company: vacancy.company || '', description: vacancy.description },
    selectedResume, facts: personal.facts,
    constraints: { targetRub: settings.targetRub ?? null, officeCity: settings.officeCity || '',
      remote: settings.remote ?? null, exclusions: settings.exclusions || [] },
  }) }];
}

function parseVacancyDecision(text, finishReason) {
  if (finishReason !== 'stop' || typeof text !== 'string' || text.length > 1000) throw jobError('JOB_MODEL_INVALID_OUTPUT');
  try { return decisionSchema.parse(JSON.parse(text)); }
  catch { throw jobError('JOB_MODEL_INVALID_OUTPUT'); }
}

module.exports = { buildVacancyPrompt, parseVacancyDecision };
