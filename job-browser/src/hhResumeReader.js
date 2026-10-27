const ID = /^[a-zA-Z0-9]{1,100}$/;
const FIELDS = ['title', 'experience', 'skills', 'education', 'summary'];
const REASONS = new Set(['invalid_id', 'invalid_shape', 'invalid_field', 'field_too_long', 'private_content',
  'empty_content', 'snapshot_too_large', 'wrong_page', 'main_missing', 'title_count', 'duplicate_section', 'section_container']);
const DOM_TAGS = new Set(['MAIN', 'SECTION', 'ARTICLE', 'DIV', 'SPAN', 'P', 'STRONG', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'OTHER', 'NONE']);
const DOM_QA = new Set(['EXPERIENCE', 'SKILLS', 'EDUCATION', 'ABOUT', 'RESUME', 'TITLE', 'RAISE', 'SECTION', 'CONTENT', 'OTHER', 'NONE']);
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
    if (Object.values(blocks).some(value => value.trim())) return { pathname, title, blocks };
    // Fixed booleans only: the page text and data-qa values never leave the browser.
    const qaNames = ['resume-block-experience', 'resume-block-skills', 'resume-block-education', 'resume-block-about'];
    const qa = qaNames.map(name => Boolean(root.querySelector(`[data-qa="${name}"]`)));
    const headingPrefixes = [/^Опыт работы/iu, /^Ключевые навыки/iu, /^Образование/iu, /^Обо мне/iu];
    const headingsInAnyTag = [false, false, false, false];
    const qaTypes = { 'resume-block-experience': 'EXPERIENCE', 'resume-block-skills': 'SKILLS',
      'resume-block-education': 'EDUCATION', 'resume-block-about': 'ABOUT',
      'resume-experience': 'EXPERIENCE', 'resume-skills': 'SKILLS', 'resume-education': 'EDUCATION',
      'resume-about': 'ABOUT', resume: 'RESUME', 'resume-title': 'TITLE', 'resume-section': 'SECTION',
      'resume-content': 'CONTENT',
      'resume-update-button_actions': 'RAISE' };
    const allowedTags = new Set(['MAIN', 'SECTION', 'ARTICLE', 'DIV', 'SPAN', 'P', 'STRONG', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI']);
    let educationLeaf = null;
    let educationNode = null;
    let educationAncestors = [];
    const textAfter = [false, false, false, false, false];
    const otherHeadingAncestors = [new Set(), new Set(), new Set()];
    let visited = 0;
    let visibleCount = 0;
    let visibleLeafCount = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node; visited < 5000 && (node = walker.nextNode()); visited++) {
      if (!visible(node)) continue;
      visibleCount++;
      if (node.children.length) continue;
      visibleLeafCount++;
      const value = node.textContent.slice(0, 100).trim();
      if (educationNode && value && (educationNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
        educationAncestors.forEach((ancestor, index) => { if (ancestor?.contains(node)) textAfter[index] = true; });
      headingPrefixes.forEach((pattern, index) => { if (pattern.test(value)) headingsInAnyTag[index] = true; });
      [0, 1, 3].forEach((index, section) => {
        if (!headingPrefixes[index].test(value)) return;
        for (let parent = node.parentElement, depth = 0; parent && depth < 12; parent = parent.parentElement, depth++)
          otherHeadingAncestors[section].add(parent);
      });
      if (!educationLeaf && headingPrefixes[2].test(value)) {
        educationNode = node;
        educationAncestors = Array.from({ length: 5 }, (_, index) => {
          let parent = node.parentElement;
          for (let step = 0; step < index; step++) parent = parent?.parentElement;
          return parent;
        });
        const tags = [], qaTypesFound = [];
        for (let ancestor = node, depth = 0; depth < 6; depth++, ancestor = ancestor?.parentElement) {
          tags.push(ancestor ? allowedTags.has(ancestor.tagName) ? ancestor.tagName : 'OTHER' : 'NONE');
          const name = ancestor?.getAttribute('data-qa');
          qaTypesFound.push(name == null ? 'NONE' : Object.hasOwn(qaTypes, name) ? qaTypes[name] : 'OTHER');
        }
        educationLeaf = { tags, qaTypesFound };
      }
    }
    if (educationNode) {
      const ancestors = [];
      for (let depth = 0; depth < 5; depth++) {
        const parent = educationAncestors[depth];
        if (!parent) { ancestors.push({ children: 0, after: false, sections: [false, false, false] }); continue; }
        const visibleChildren = [...parent.children].slice(0, 21).filter(visible).length;
        ancestors.push({ children: Math.min(visibleChildren, 20), after: textAfter[depth],
          sections: otherHeadingAncestors.map(found => found.has(parent)) });
      }
      educationLeaf.ancestors = ancestors;
    }
    return { pathname, title, blocks, structure: { qa, headingsInAnyTag,
      dom: { visited, visibleCount, visibleLeafCount, educationLeaf } } };
  });
  if (raw?.pathname !== `/resume/${resumeId}`) fail('wrong_page');
  if (raw?.failure) fail(raw.failure);
  if (!Array.isArray(raw?.title) || raw.title.length !== 1) fail('title_count');
  if (!raw.blocks) fail('invalid_shape');
  const snapshot = { resumeId, title: raw.title[0], experience: raw.blocks.experience || '',
    skills: raw.blocks.skills || '', education: raw.blocks.education || '', summary: raw.blocks.summary || '',
    grammaticalGender: 'unknown' };
  if (![snapshot.experience, snapshot.skills, snapshot.education, snapshot.summary].some(value => value.trim())) {
    const flags = [...(raw.structure?.qa || []), ...(raw.structure?.headingsInAnyTag || [])];
    const safe = flags.length === 8 && flags.every(flag => typeof flag === 'boolean') ? flags : Array(8).fill(false);
    process.stderr.write(`JOB_HH_RESUME_STRUCTURE ${safe.map(flag => flag ? '1' : '0').join('')}\n`);
    const dom = raw.structure?.dom;
    const count = value => Number.isInteger(value) && value >= 0 && value <= 5000 ? value : 0;
    const tags = dom?.educationLeaf?.tags;
    const qaTypesFound = dom?.educationLeaf?.qaTypesFound;
    const safeTags = Array.isArray(tags) && tags.length === 6 && tags.every(tag => DOM_TAGS.has(tag)) ? tags : Array(6).fill('NONE');
    const safeQa = Array.isArray(qaTypesFound) && qaTypesFound.length === 6 && qaTypesFound.every(type => DOM_QA.has(type))
      ? qaTypesFound : Array(6).fill('NONE');
    process.stderr.write(`JOB_HH_RESUME_DOM visited=${count(dom?.visited)} visible=${count(dom?.visibleCount)} leaf=${count(dom?.visibleLeafCount)} tags=${safeTags.join(',')} qa=${safeQa.join(',')}\n`);
    const ancestorData = dom?.educationLeaf?.ancestors;
    const validAncestor = item => item && Number.isInteger(item.children) && item.children >= 0 && item.children <= 20
      && typeof item.after === 'boolean'
      && Array.isArray(item.sections) && item.sections.length === 3 && item.sections.every(value => typeof value === 'boolean');
    const safeAncestors = Array.isArray(ancestorData) && ancestorData.length === 5 && ancestorData.every(validAncestor)
      ? ancestorData : Array.from({ length: 5 }, () => ({ children: 0, after: false, sections: [false, false, false] }));
    process.stderr.write(`JOB_HH_RESUME_EDUCATION ${safeAncestors.map(item => `${item.children}:${item.after ? 1 : 0}:${item.sections.map(value => value ? 1 : 0).join('')}`).join('|')}\n`);
  }
  return resumeSnapshotSchema(snapshot, resumeId);
}

module.exports = { readResumeContent, resumeSnapshotSchema };
