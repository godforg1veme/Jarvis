const ID = /^[a-zA-Z0-9]{1,100}$/;
const FIELDS = ['title', 'experience', 'skills', 'education', 'summary'];
const fail = () => { throw Object.assign(new Error('JOB_HH_RESUME_UNAVAILABLE'), { code: 'JOB_HH_RESUME_UNAVAILABLE' }); };
const privateContent = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?7|8)[\s(\-]*\d{3}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}|(?:телефон|e-?mail|адрес проживания|контактные данные)\s*[:：])/iu;

function resumeSnapshotSchema(value, resumeId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 7 || !FIELDS.every(key => Object.hasOwn(value, key))
    || !Object.hasOwn(value, 'resumeId') || !Object.hasOwn(value, 'grammaticalGender')
    || !ID.test(value.resumeId) || value.resumeId !== resumeId
    || !['male', 'female', 'unknown'].includes(value.grammaticalGender)) fail();
  for (const key of FIELDS) if (typeof value[key] !== 'string' || value[key].length > 12000 || privateContent.test(value[key])) fail();
  if (!value.title.trim() || ![value.experience, value.skills, value.education, value.summary].some(s => s.trim())
    || JSON.stringify(value).length > 60000) fail();
  return value;
}

async function readResumeContent(page, resumeId) {
  if (!ID.test(resumeId)) fail();
  const raw = await page.evaluate(() => {
    const visible = node => node && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible';
    const pathname = new URL(location.href).pathname;
    const root = document.querySelector('main');
    if (!root || !visible(root)) return { pathname };
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
      if (headings.length > 1) return { pathname };
      if (headings.length === 1) {
        const section = headings[0].closest('section,[data-qa^="resume-block-"]');
        if (!section || !visible(section)) return { pathname };
        const value = section.innerText || '';
        blocks[key] = value.slice(0, 12001);
      }
    }
    return { pathname, title, blocks };
  });
  if (raw?.pathname !== `/resume/${resumeId}` || !Array.isArray(raw.title) || raw.title.length !== 1 || !raw.blocks) fail();
  const snapshot = { resumeId, title: raw.title[0], experience: raw.blocks.experience || '',
    skills: raw.blocks.skills || '', education: raw.blocks.education || '', summary: raw.blocks.summary || '',
    grammaticalGender: 'unknown' };
  return resumeSnapshotSchema(snapshot, resumeId);
}

module.exports = { readResumeContent, resumeSnapshotSchema };
