const { jobError } = require('./jobSchemas');
const { buildDutyEvidenceContext } = require('./jobVacancyPrompt');
const { loadInstruction } = require('../prompts/instructionFiles');

const instructions = loadInstruction('job-direction');

function buildDirectionVerificationPrompt({ vacancy, settings } = {}) {
  if (!vacancy || typeof vacancy.title !== 'string' || typeof vacancy.description !== 'string'
    || JSON.stringify(vacancy).length > 131072 || !Array.isArray(settings?.queries)
    || settings.queries.length > 100 || settings.queries.some(query => typeof query !== 'string'
      || !query.trim() || query.length > 200)) throw jobError('JOB_INVALID_VACANCY');
  const source = { vacancy: { title: vacancy.title, description: vacancy.description },
    queries: settings.queries, ...buildDutyEvidenceContext(vacancy.description) };
  return [{ role: 'system', content: instructions },
    { role: 'user', content: JSON.stringify(source) }];
}

module.exports = { buildDirectionVerificationPrompt };
