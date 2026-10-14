const { evaluateSalary } = require('./salaryRules');
const { defaultJobSettings } = require('./jobSearchDefaults');

const ROLE = /(?:\b(?:ai|llm|ml|nlp|rag|genai)\b[\s/-]*(?:engineer|engineering|developer|qa|tester|intern|agent|automation|enablement|implementation|solutions?|system analyst|business analyst|quality)|(?:applied|generative|conversational|junior)\s+ai|prompt\s+engineer|context\s+engineering|research\s+(?:engineer|scientist)|machine\s+learning|conversation\s+designer|пром[п]?т|чат[ -]?бот|стаж[её]р.*(?:ai|ии|ml)|(?:аи|ии)[ -]?(?:инженер|разработчик)|машинн[а-яё ]+обучен)/iu;
const TASK = /(?:интеграц[а-яё ]+(?:llm|ai|ии)|(?:разработ|внедр|автоматизац|дообучен|обучен)[^.!?\n]{0,80}(?:llm|ai|\bии\b|агент|модел)|(?:llm|ai|\bии\b)[^.!?\n]{0,80}(?:автоматизац|интеграц|разработ)|rag[ -]?(?:pipeline|систем)|fine[ -]?tuning)/iu;
const SALES = /(?:менеджер|специалист|агент)\s+(?:по\s+)?продаж|sales\s+(?:manager|representative)|холодн[а-яё ]{0,20}звон|cold\s+call/iu;

function evaluateVacancy({ vacancy, settings = defaultJobSettings(), rateSnapshot }) {
  const title = String(vacancy.title || '');
  const description = String(vacancy.description || '').replace(/<[^>]*>/g, ' ');
  const annotations = [];
  const reasons = [];
  if (!ROLE.test(title) && !TASK.test(description) && !ROLE.test(description)) reasons.push('OUTSIDE_SEARCH');
  if (SALES.test(title) || /(?:обязанност|задач)[^.!?\n]{0,120}(?:холодн[а-яё ]{0,20}звон|cold\s+call)/iu.test(description)
    || /^(?:холодн[а-яё ]{0,20}звон|cold\s+call)/iu.test(description)) reasons.push('SALES_DUTIES');
  if (vacancy.workFormat === 'remote') {
    if (!settings.remote || vacancy.remoteRestriction === 'foreign_only') reasons.push('LOCATION_EXCLUDED');
    else if (vacancy.remoteRestriction !== 'moscow_allowed') annotations.push('REMOTE_ELIGIBILITY_UNKNOWN');
  } else if (vacancy.workFormat && vacancy.workFormat !== 'unknown' && vacancy.city
    && String(vacancy.city).toLowerCase() !== String(settings.officeCity).toLowerCase()) reasons.push('LOCATION_EXCLUDED');
  else if (!vacancy.workFormat || vacancy.workFormat === 'unknown' || !vacancy.city) annotations.push('LOCATION_UNKNOWN');
  for (const word of settings.exclusions || []) {
    if (word && `${title}\n${description}`.toLowerCase().includes(word.toLowerCase())) reasons.push('USER_EXCLUSION');
  }
  const pay = evaluateSalary({ salary: vacancy.salary, description, targetRub: settings.targetRub, rateSnapshot });
  return { include: reasons.length === 0 && pay.include, reasonCodes: [...new Set([...reasons, ...pay.reasonCodes])],
    annotations: [...new Set([...annotations, ...pay.annotations])] };
}

module.exports = { evaluateVacancy };
