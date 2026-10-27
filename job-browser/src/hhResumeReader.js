const ID = /^[a-zA-Z0-9]{1,100}$/;
const FIELDS = ['title', 'experience', 'skills', 'education', 'summary'];
const REASONS = new Set(['invalid_id', 'invalid_shape', 'invalid_field', 'field_too_long', 'private_content',
  'empty_content', 'snapshot_too_large', 'wrong_page', 'main_missing', 'title_count', 'duplicate_section', 'section_container']);
const fail = (reason) => {
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

async function readResumeContent(page, resumeId) {
  if (!ID.test(resumeId)) fail('invalid_id');
  const raw = await page.evaluate(() => {
    const visible = node => node && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible';
    const pathname = new URL(location.href).pathname;
    const root = document.querySelector('main');
    if (!root || !visible(root)) return { pathname, failure: 'main_missing' };
    const title = [...root.querySelectorAll('h1')].filter(visible).map(n => n.innerText.trim());
    const labels = {
      experience: /^(?:Опыт работы|Опыт)$/iu,
      skills: /^(?:Ключевые навыки|Навыки)$/iu,
      education: /^Образование$/iu,
      summary: /^(?:Обо мне|О себе|Дополнительная информация)$/iu,
    };
    const blocks = {};
    for (const [key, pattern] of Object.entries(labels)) {
      const headings = [...root.querySelectorAll('h2,h3')].filter(n => visible(n) && pattern.test(n.textContent.trim()));
      if (headings.length > 1) return { pathname, failure: 'duplicate_section' };
      if (headings.length === 1) {
        const section = headings[0].closest('section,[data-qa^="resume-block-"]');
        if (!section || !visible(section)) return { pathname, failure: 'section_container' };
        const value = section.innerText || '';
        blocks[key] = value.slice(0, 12001);
      }
    }
    return { pathname, title, blocks };
  });
  if (raw?.pathname !== `/resume/${resumeId}`) fail('wrong_page');
  if (raw?.failure) fail(raw.failure);
  if (!Array.isArray(raw?.title) || raw.title.length !== 1) fail('title_count');
  if (!raw.blocks) fail('invalid_shape');
  const snapshot = { resumeId, title: raw.title[0], experience: raw.blocks.experience || '',
    skills: raw.blocks.skills || '', education: raw.blocks.education || '', summary: raw.blocks.summary || '',
    grammaticalGender: 'unknown' };
  return resumeSnapshotSchema(snapshot, resumeId);
}

module.exports = { readResumeContent, resumeSnapshotSchema };
