const ID = /^[a-zA-Z0-9]{1,100}$/;
const FIELDS = ['title', 'experience', 'skills', 'education', 'summary'];
const REASONS = new Set(['invalid_id', 'invalid_shape', 'invalid_field', 'field_too_long', 'private_content',
  'empty_content', 'snapshot_too_large', 'wrong_page', 'main_missing', 'title_count', 'duplicate_section',
  'section_container', 'ssr_template', 'ssr_size', 'ssr_parse', 'ssr_incomplete', 'ssr_ambiguous', 'ssr_shape', 'incomplete_content']);
const fail = reason => {
  process.stderr.write(`JOB_HH_RESUME_READ_FAILURE ${REASONS.has(reason) ? reason : 'invalid_shape'}\n`);
  throw Object.assign(new Error('JOB_HH_RESUME_UNAVAILABLE'), { code: 'JOB_HH_RESUME_UNAVAILABLE' });
};
const privateContent = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?7|8)[\s(\-]*\d{3}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}|(?:телефон|e-?mail|адрес проживания|контактные данные)\s*[:：])/iu;

function resumeSnapshotSchema(value, resumeId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 7 || !FIELDS.every(key => Object.hasOwn(value, key))
    || !Object.hasOwn(value, 'resumeId') || !Object.hasOwn(value, 'grammaticalGender')
    || !ID.test(value.resumeId) || value.resumeId !== resumeId
    || !['male', 'female', 'unknown'].includes(value.grammaticalGender)) fail('invalid_shape');
  for (const key of FIELDS) {
    if (typeof value[key] !== 'string') fail('invalid_field');
    if (value[key].length > 12000) fail('field_too_long');
    if (privateContent.test(value[key])) fail('private_content');
  }
  if (!value.title.trim() || ![value.experience, value.skills, value.education, value.summary].some(s => s.trim())) fail('empty_content');
  if (JSON.stringify(value).length > 60000) fail('snapshot_too_large');
  return value;
}

async function readResumeContent(page, resumeId, { requireComplete = false } = {}) {
  if (!ID.test(resumeId)) fail('invalid_id');
  const raw = await page.evaluate(({ selectedId, requireComplete }) => {
    const pathname = new URL(location.href).pathname;
    if (location.origin !== 'https://hh.ru' || pathname !== `/resume/${selectedId}`)
      return { failure: 'wrong_page' };
    const visible = node => node && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible';
    const root = document.querySelector('main');
    if (!root || !visible(root)) return { failure: 'main_missing' };
    const title = [...root.querySelectorAll('h1')].filter(visible).map(node => node.innerText.trim());
    if (title.length !== 1) return { failure: 'title_count' };
    const labels = {
      experience: /^(?:Опыт работы|Опыт)$/iu,
      skills: /^(?:Ключевые навыки|Навыки)$/iu,
      education: /^Образование$/iu,
      summary: /^(?:Обо мне|О себе|Дополнительная информация)$/iu,
      languages: /^(?:Знание языков|Языки)$/iu,
      courses: /^(?:Повышение квалификации|Курсы|Повышение квалификации, курсы)$/iu,
      certificates: /^(?:Тесты, экзамены|Сертификаты|Электронные сертификаты)$/iu,
    };
    const blocks = {};
    for (const [key, pattern] of Object.entries(labels)) {
      const headings = [...root.querySelectorAll('h2,h3')].filter(node => visible(node) && pattern.test(node.textContent.trim()));
      if (headings.length > 1) return { failure: 'duplicate_section' };
      if (headings.length === 1) {
        const section = headings[0].closest('section,[data-qa^="resume-block-"]');
        if (!section || !visible(section)) return { failure: 'section_container' };
        blocks[key] = (section.innerText || '').slice(0, 12001);
      }
    }
    if (Object.values(blocks).some(value => value.trim())) {
      const complete = ['experience','skills','education','summary'].every(key => Object.hasOwn(blocks,key))
        && !root.querySelector('[aria-busy="true"]')
        && [...root.querySelectorAll('h2,h3')].every(node =>
          !Object.values(labels).some(pattern => pattern.test(node.textContent.trim())) || visible(node));
      return { title: title[0], blocks, complete };
    }
    const templates = document.querySelectorAll('template#HH-Lux-InitialState');
    if (templates.length !== 1) return { failure: 'ssr_template' };
    const content = templates[0].content;
    const node = content?.firstChild;
    if (content?.childNodes.length !== 1 || node?.nodeType !== Node.TEXT_NODE || node.textContent.length > 1048576)
      return { failure: 'ssr_size' };
    const source = node.textContent;
    if (new TextEncoder().encode(source).length > 1048576) return { failure: 'ssr_size' };
    let parsed;
    try { parsed = JSON.parse(source); } catch { return { failure: 'ssr_parse' }; }
    const queue = [{ value: parsed, depth: 0 }];
    let examined = 0;
    let candidate = null;
    let matches = 0;
    for (let index = 0; index < queue.length; index++) {
      if (examined >= 20000) return { failure: 'ssr_incomplete' };
      const { value, depth } = queue[index];
      if (!value || typeof value !== 'object') continue;
      examined++;
      if (!Array.isArray(value) && Object.hasOwn(value, 'applicantResume')) {
        matches++;
        if (matches > 1) return { failure: 'ssr_ambiguous' };
        candidate = value.applicantResume;
      }
      const children = Object.values(value).filter(child => child && typeof child === 'object');
      if (depth >= 64 && children.length) return { failure: 'ssr_incomplete' };
      if (queue.length + children.length > 20000) return { failure: 'ssr_incomplete' };
      for (const child of children) queue.push({ value: child, depth: depth + 1 });
    }
    if (matches !== 1 || !candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return { failure: 'ssr_ambiguous' };
    const stringArray = value => {
      if (!Array.isArray(value)) return null;
      const result = [];
      for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
          || Object.keys(item).length !== 1 || typeof item.string !== 'string'
          || !item.string.trim() || item.string.length > 12000) return null;
        result.push(item.string.trim());
      }
      return result;
    };
    const titles = stringArray(candidate.title);
    const skills = stringArray(candidate.skills);
    // The authenticated resume editor renders career cards without h2/h3 headings.
    // Its bound initial state is complete only when every career field has an
    // explicit, recognized shape. Keep all other state, including contacts, inside
    // the browser context.
    if (requireComplete) {
      const required = ['experience', 'keySkills', 'resumeApplicantSkills', 'skills', 'educationLevel', 'primaryEducation', 'elementaryEducation',
        'additionalEducation', 'attestationEducation', 'certificate', 'externalCertificates',
        'availableExternalCertificates', 'language', 'employment', 'employmentForms',
        'workFormats', 'workSchedule', 'relocation', 'businessTripReadiness', 'travelTime'];
      if (candidate._attributes?.hash !== selectedId || !Array.isArray(candidate.hiddenFields)
        || candidate.hiddenFields.length !== 0 || !titles?.length || !skills
        || required.some(key => !Array.isArray(candidate[key]))
        || root.querySelector('[aria-busy="true"]') || title[0] !== titles.join(' '))
        return { failure: 'incomplete_content' };
      // These optional fields have no observed complete schema yet. Never drop
      // nonempty entries and call the result a full resume.
      if (['additionalEducation', 'attestationEducation', 'certificate', 'externalCertificates',
        'availableExternalCertificates'].some(key => candidate[key].length))
        return { failure: 'ssr_shape' };
      const keySkills = stringArray(candidate.keySkills);
      const preferences = ['employment', 'employmentForms', 'workFormats', 'workSchedule',
        'relocation', 'businessTripReadiness', 'travelTime'].map(key => [key, stringArray(candidate[key])]);
      if (!keySkills || preferences.some(([, values]) => !values)) return { failure: 'ssr_shape' };
      const boundedText = value => typeof value === 'string' && value.length <= 12000;
      const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      const applicantSkills = [];
      for (const item of candidate.resumeApplicantSkills) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
          || !boundedText(item.name) || !item.name.trim()) return { failure: 'ssr_shape' };
        let level = '';
        if (item.level !== null && item.level !== undefined) {
          if (typeof item.level === 'string' && boundedText(item.level)) level = item.level;
          else if (Number.isInteger(item.level) && item.level >= 0 && item.level <= 100) level = String(item.level);
          else if (typeof item.level === 'object' && !Array.isArray(item.level)
            && boundedText(item.level.name) && item.level.name.trim()) level = item.level.name;
          else return { failure: 'ssr_shape' };
        }
        applicantSkills.push(`${item.name.trim()}${level ? ` (уровень: ${level})` : ''}`);
      }
      const experience = [];
      for (const item of candidate.experience) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
          || !boundedText(item.position) || !item.position.trim()
          || !boundedText(item.description) || !boundedText(item.companyName)
          || !date(item.startDate) || !(item.endDate === null || date(item.endDate) && item.endDate >= item.startDate))
          return { failure: 'ssr_shape' };
        experience.push([item.position.trim(), item.companyName.trim(),
          `${item.startDate} — ${item.endDate || 'по настоящее время'}`, item.description.trim()]
          .filter(Boolean).join('\n'));
      }
      const educationLevels = stringArray(candidate.educationLevel);
      if (!educationLevels) return { failure: 'ssr_shape' };
      const education = educationLevels.length ? [`Уровень образования: ${educationLevels.join(', ')}`] : [];
      for (const item of candidate.primaryEducation) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
          || !boundedText(item.name) || !boundedText(item.organization) || !boundedText(item.result)
          || !boundedText(item.educationLevel)
          || !Number.isInteger(item.year) || item.year < 1900 || item.year > 2200)
          return { failure: 'ssr_shape' };
        education.push([item.name.trim(), item.organization.trim(), item.result.trim(), String(item.year), item.educationLevel]
          .filter(Boolean).join(' · '));
      }
      for (const item of candidate.elementaryEducation) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
          || !boundedText(item.name) || !Number.isInteger(item.year) || item.year < 1900 || item.year > 2200)
          return { failure: 'ssr_shape' };
        education.push([item.name.trim(), String(item.year)].filter(Boolean).join(' · '));
      }
      const language = [];
      for (const item of candidate.language) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
          || !Number.isInteger(item.id) || item.id < 1 || item.id > 9999
          || !boundedText(item.degree) || !/^[A-Za-zА-Яа-я0-9_.-]{1,30}$/.test(item.degree))
          return { failure: 'ssr_shape' };
        language.push(`${{ 34: 'Русский', 57: 'Английский' }[item.id] || `Язык HH #${item.id}`} · ${item.degree}`);
      }
      const summary = [skills.join('\n'),
        language.length ? `Языки: ${language.join(', ')}` : '',
        ...preferences.filter(([, values]) => values.length).map(([key, values]) => `${key}: ${values.join(', ')}`)]
        .filter(Boolean).join('\n\n');
      return { title: titles.join(' '), blocks: { experience: experience.join('\n\n'),
        skills: [...new Set([...keySkills, ...applicantSkills])].join(', '), education: education.join('\n\n'), summary }, complete: true };
    }
    if (!titles || titles.length === 0 || !skills || !Array.isArray(candidate.experience))
      return { failure: 'ssr_shape' };
    const experience = [];
    for (const item of candidate.experience) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || typeof item.position !== 'string' || typeof item.description !== 'string'
        || !item.position.trim() || !item.description.trim()
        || item.position.length > 12000 || item.description.length > 12000)
        return { failure: 'ssr_shape' };
      experience.push(`${item.position.trim()}\n${item.description.trim()}`);
    }
    return { title: titles.join(' '), blocks: { experience: experience.join('\n\n'), skills: skills.join(', '),
      education: '', summary: '' } };
  }, { selectedId: resumeId, requireComplete });
  if (raw?.failure) fail(raw.failure);
  if (!raw || typeof raw.title !== 'string' || !raw.blocks || typeof raw.blocks !== 'object') fail('invalid_shape');
  // The legacy SSR fallback does not prove education/about coverage. Never
  // silently evaluate or submit automatically using that partial snapshot.
  if (requireComplete && raw.complete !== true) fail('incomplete_content');
  const snapshot = { resumeId, title: raw.title, experience: raw.blocks.experience || '',
    skills: raw.blocks.skills || '', education: raw.blocks.education || '',
    summary: [raw.blocks.summary,raw.blocks.languages,raw.blocks.courses,raw.blocks.certificates].filter(Boolean).join('\n\n'),
    grammaticalGender: 'unknown' };
  return resumeSnapshotSchema(snapshot, resumeId);
}

module.exports = { readResumeContent, resumeSnapshotSchema };
