const { evaluateSalary } = require('./salaryRules');
const { defaultJobSettings } = require('./jobSearchDefaults');

function evaluateVacancy({ vacancy, settings = defaultJobSettings(), rateSnapshot }) {
  const title = String(vacancy.title || '');
  const description = String(vacancy.description || '').replace(/<[^>]*>/g, ' ');
  const annotations = [];
  const reasons = [];
  if (settings.remote === false && vacancy.workFormat === 'remote') reasons.push('LOCATION_EXCLUDED');
  if (settings.remote === true && vacancy.workFormat === 'remote') {
    if (vacancy.remoteRestriction === 'foreign_only') reasons.push('LOCATION_EXCLUDED');
    else if (vacancy.remoteRestriction !== 'moscow_allowed') annotations.push('REMOTE_ELIGIBILITY_UNKNOWN');
  }
  if (settings.officeCity && vacancy.workFormat !== 'remote') {
    if (vacancy.workFormat && vacancy.workFormat !== 'unknown' && vacancy.city
      && String(vacancy.city).toLowerCase() !== String(settings.officeCity).toLowerCase()) reasons.push('LOCATION_EXCLUDED');
    else if (!vacancy.workFormat || vacancy.workFormat === 'unknown' || !vacancy.city) annotations.push('LOCATION_UNKNOWN');
  }
  for (const word of settings.exclusions || []) {
    if (word && `${title}\n${description}`.toLowerCase().includes(word.toLowerCase())) reasons.push('USER_EXCLUSION');
  }
  const pay = evaluateSalary({ salary: vacancy.salary, description, targetRub: settings.targetRub, rateSnapshot });
  return { include: reasons.length === 0 && pay.include, reasonCodes: [...new Set([...reasons, ...pay.reasonCodes])],
    annotations: [...new Set([...annotations, ...pay.annotations])] };
}

module.exports = { evaluateVacancy };
