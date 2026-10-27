const ID = /^[a-zA-Z0-9]{1,100}$/;
const FIELDS = ['title', 'experience', 'skills', 'education', 'summary'];
const REASONS = new Set(['invalid_id', 'invalid_shape', 'invalid_field', 'field_too_long', 'private_content',
  'empty_content', 'snapshot_too_large', 'wrong_page', 'main_missing', 'title_count', 'duplicate_section', 'section_container']);
const DOM_TAGS = new Set(['MAIN', 'SECTION', 'ARTICLE', 'DIV', 'SPAN', 'P', 'STRONG', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'OTHER', 'NONE']);
const DOM_QA = new Set(['EXPERIENCE', 'SKILLS', 'EDUCATION', 'ABOUT', 'RESUME', 'TITLE', 'RAISE', 'SECTION', 'CONTENT', 'OTHER', 'NONE']);
const INITIAL_KEYS = ['id', 'resumeId', 'hash', 'experience', 'education', 'skills', 'skillSet', 'title',
  'position', 'description', 'company', 'name', 'level', 'primary', 'additional', 'professionalRoles',
  'text', 'value', 'label', 'skill', 'skillName', 'skill_name', 'displayName', 'display_name',
  'positionName', 'position_name', 'specialization', 'professions', 'items', 'valueText'];
const INITIAL_TYPES = new Set(['U', 'Z', 'A', 'O', 'S', 'D', 'B']);
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
  const raw = await page.evaluate((selectedId) => {
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
    const safeKeys = ['id', 'resumeId', 'hash', 'experience', 'education', 'skills', 'skillSet', 'title',
      'position', 'description', 'company', 'name', 'level', 'primary', 'additional', 'professionalRoles',
      'text', 'value', 'label', 'skill', 'skillName', 'skill_name', 'displayName', 'display_name',
      'positionName', 'position_name', 'specialization', 'professions', 'items', 'valueText'];
    const initialState = { template: false, parsed: false, bounded: true, applicantResume: false,
      fields: [false, false, false, false, false, false], matches: 0,
      types: ['U', 'U', 'U'], nested: Array.from({ length: 3 }, () => Array(safeKeys.length).fill('U')),
      identity: { candidate: 'UUU', parent: 'UUU', skillsFirst: 'U', titleFirst: 'U', heading: 'U' } };
    const template = document.getElementById('HH-Lux-InitialState');
    if (template?.tagName === 'TEMPLATE') {
      initialState.template = true;
      const node = template.content?.firstChild;
      if (template.content?.childNodes.length !== 1 || node?.nodeType !== Node.TEXT_NODE
        || node.textContent.length > 1048576) initialState.bounded = false;
      else {
        const source = node.textContent;
        if (new TextEncoder().encode(source).length > 1048576) initialState.bounded = false;
        else {
          let parsed;
          try { parsed = JSON.parse(source); initialState.parsed = true; } catch {}
          if (initialState.parsed) {
            const typeOf = value => value === undefined ? 'U' : value === null ? 'Z' : Array.isArray(value) ? 'A'
              : typeof value === 'object' ? 'O' : typeof value === 'string' ? 'S'
                : typeof value === 'number' ? 'D' : typeof value === 'boolean' ? 'B' : 'U';
            const queue = [{ value: parsed, depth: 0 }];
            let candidate = null;
            let examined = 0;
            for (let index = 0; index < queue.length && examined < 20000; index++) {
              const { value, depth } = queue[index];
              if (!value || typeof value !== 'object') continue;
              examined++;
              const hasResumeKey = !Array.isArray(value) && Object.hasOwn(value, 'applicantResume');
              if (hasResumeKey) initialState.matches = Math.min(2, initialState.matches + 1);
              const resume = hasResumeKey ? value.applicantResume : null;
              if (!initialState.applicantResume && resume && typeof resume === 'object' && !Array.isArray(resume)) {
                initialState.applicantResume = true;
                candidate = { resume, parent: value };
                initialState.fields = ['experience', 'education', 'skills', 'skillSet', 'title', 'id']
                  .map(name => Object.hasOwn(resume, name));
                initialState.types = ['experience', 'skills', 'title'].map(name => typeOf(resume[name]));
                initialState.nested = ['experience', 'skills', 'title'].map(name => {
                  const direct = resume[name];
                  const entry = Array.isArray(direct) ? direct[0] : direct;
                  return safeKeys.map(key => entry && typeof entry === 'object' && !Array.isArray(entry)
                    ? typeOf(entry[key]) : 'U');
                });
              }
              if (depth >= 64) {
                if (Object.values(value).some(child => child && typeof child === 'object')) initialState.bounded = false;
                continue;
              }
              for (const child of Object.values(value)) {
                if (!child || typeof child !== 'object') continue;
                if (queue.length >= 20001) { initialState.bounded = false; break; }
                queue.push({ value: child, depth: depth + 1 });
              }
            }
            if (queue.length > 20000) initialState.bounded = false;
            if (initialState.matches === 1 && candidate) {
              const fixedMatches = object => ['id', 'resumeId', 'hash'].map(key =>
                Object.hasOwn(object, key) && typeof object[key] === 'string' && object[key] === selectedId ? 'Y' : 'N').join('');
              const titleFields = ['text', 'value', 'label', 'name', 'title', 'position', 'positionName', 'position_name',
                'displayName', 'display_name', 'skill', 'skillName', 'skill_name'];
              const entries = [candidate.resume.title?.[0], candidate.resume.skills?.[0]];
              const headingMatches = title.length === 1 && title[0]
                ? entries.reduce((count, entry) => count + (entry && typeof entry === 'object' && !Array.isArray(entry)
                  ? titleFields.filter(key => typeof entry[key] === 'string' && entry[key] === title[0]).length : 0), 0) : 0;
              initialState.identity = {
                candidate: fixedMatches(candidate.resume),
                parent: fixedMatches(candidate.parent),
                skillsFirst: typeOf(Array.isArray(candidate.resume.skills) ? candidate.resume.skills[0] : undefined),
                titleFirst: typeOf(Array.isArray(candidate.resume.title) ? candidate.resume.title[0] : undefined),
                heading: title.length === 1 && title[0] ? headingMatches === 1 ? 'Y' : headingMatches === 0 ? 'N' : 'U' : 'U',
              };
            }
          }
        }
      }
    }
    return { pathname, title, blocks, structure: { qa, headingsInAnyTag,
      dom: { visited, visibleCount, visibleLeafCount, educationLeaf }, initialState } };
  }, resumeId);
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
    const state = raw.structure?.initialState;
    const safeState = state && ['template', 'parsed', 'bounded', 'applicantResume'].every(key => typeof state[key] === 'boolean')
      && Array.isArray(state.fields) && state.fields.length === 6 && state.fields.every(value => typeof value === 'boolean')
      ? state : { template: false, parsed: false, bounded: false, applicantResume: false, fields: Array(6).fill(false) };
    process.stderr.write(`JOB_HH_RESUME_INITIAL_STATE ${[safeState.template, safeState.parsed, safeState.bounded, safeState.applicantResume,
      ...safeState.fields].map(value => value ? 1 : 0).join('')}\n`);
    const validTypes = values => Array.isArray(values) && values.length === 3 && values.every(code => INITIAL_TYPES.has(code));
    const validNested = values => Array.isArray(values) && values.length === 3
      && values.every(row => Array.isArray(row) && row.length === INITIAL_KEYS.length && row.every(code => INITIAL_TYPES.has(code)));
    const shape = Number.isInteger(safeState.matches) && safeState.matches >= 0 && safeState.matches <= 2
      && validTypes(safeState.types) && validNested(safeState.nested) ? safeState : null;
    const format = (type, row) => `${type}/${INITIAL_KEYS.map((key, index) => `${key}:${row[index]}`).join(',')}`;
    const unknown = Array(INITIAL_KEYS.length).fill('U');
    process.stderr.write(`JOB_HH_RESUME_INITIAL_SHAPE count=${shape?.matches || 0} experience=${format(shape?.types[0] || 'U', shape?.nested[0] || unknown)} skills=${format(shape?.types[1] || 'U', shape?.nested[1] || unknown)} title=${format(shape?.types[2] || 'U', shape?.nested[2] || unknown)}\n`);
    const identity = shape?.identity;
    const safeIdentity = identity && /^[YNU]{3}$/.test(identity.candidate) && /^[YNU]{3}$/.test(identity.parent)
      && INITIAL_TYPES.has(identity.skillsFirst) && INITIAL_TYPES.has(identity.titleFirst) && /^[YNU]$/.test(identity.heading)
      ? identity : { candidate: 'UUU', parent: 'UUU', skillsFirst: 'U', titleFirst: 'U', heading: 'U' };
    process.stderr.write(`JOB_HH_RESUME_INITIAL_IDENTITY seen=${shape?.matches || 0} complete=${safeState.template && safeState.parsed && safeState.bounded ? 1 : 0} candidate=${safeIdentity.candidate} parent=${safeIdentity.parent} skillsFirst=${safeIdentity.skillsFirst} titleFirst=${safeIdentity.titleFirst} heading=${safeIdentity.heading}\n`);
  }
  return resumeSnapshotSchema(snapshot, resumeId);
}

module.exports = { readResumeContent, resumeSnapshotSchema };
