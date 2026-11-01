const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readResumeContent, resumeSnapshotSchema } = require('../src/hhResumeReader');

async function captureFailure(run) {
  const original = process.stderr.write;
  const lines = [];
  process.stderr.write = function (chunk, ...rest) { lines.push(String(chunk)); return true; };
  try { await assert.rejects(run(), { code: 'JOB_HH_RESUME_UNAVAILABLE' }); }
  finally { process.stderr.write = original; }
  return lines.join('');
}

test('local resume fixture extracts explicit sections and excludes contact card', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); }
  catch { t.skip('Local Chromium is unavailable'); return; }
  try {
    const page = await browser.newPage();
    await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `
      <main><h1>Менеджер продукта</h1>
      <section><h2>Опыт работы</h2><p>Автоматизировала аналитическую отчётность.</p></section>
      <section><h2>Ключевые навыки</h2><p>Excel, сводные таблицы</p></section>
      <section><h2>Образование</h2><p>Высшее</p></section>
      <section><h2>Обо мне</h2><p>Работа с данными</p></section></main>
      <aside>Телефон: +7 999 123 45 67</aside>` }));
    await page.goto('https://hh.ru/resume/fixture123');
    const snapshot = await readResumeContent(page, 'fixture123');
    assert.deepEqual(await readResumeContent(page, 'fixture123', { requireComplete: true }), snapshot);
    assert.equal(snapshot.resumeId, 'fixture123');
    assert.equal(snapshot.grammaticalGender, 'unknown');
    assert.match(snapshot.experience, /Автоматизировала/);
    assert.doesNotMatch(JSON.stringify(snapshot), /999|Телефон/);
    await assert.rejects(readResumeContent(page, 'other'), { code: 'JOB_HH_RESUME_UNAVAILABLE' });
    await page.close();
  } finally { await browser.close(); }
});

test('snapshot rejects private data, extra keys and oversized blocks', () => {
  const base = { resumeId: 'fixture123', title: 'Роль', experience: 'Аналитика', skills: '', education: '', summary: '', grammaticalGender: 'unknown' };
  assert.deepEqual(resumeSnapshotSchema(base, 'fixture123'), base);
  for (const sample of [{ ...base, email: 'x' }, { ...base, experience: 'x'.repeat(12001) },
    { ...base, experience: 'Контактные данные: скрытые' }, { ...base, grammaticalGender: 'guessed' }])
    assert.throws(() => resumeSnapshotSchema(sample, 'fixture123'), { code: 'JOB_HH_RESUME_UNAVAILABLE' });
});

test('failure diagnostics use closed reason codes without resume content', async () => {
  const base = { resumeId: 'fixture123', title: 'Роль', experience: 'Аналитика', skills: '', education: '', summary: '', grammaticalGender: 'unknown' };
  const cases = [
    [{ ...base, experience: 'Контактные данные: secret@example.com' }, 'private_content'],
    [{ ...base, experience: 'x'.repeat(12001) }, 'field_too_long'],
    [{ ...base, experience: '' }, 'empty_content'],
    [{ ...base, title: 'Чужое имя', unexpected: 'secret@example.com' }, 'invalid_shape'],
  ];
  for (const [snapshot, reason] of cases) {
    const output = await captureFailure(() => Promise.resolve().then(() => resumeSnapshotSchema(snapshot, 'fixture123')));
    assert.equal(output, `JOB_HH_RESUME_READ_FAILURE ${reason}\n`);
    assert.doesNotMatch(output, /secret|fixture123|Чужое имя|Контактные данные/);
  }
});

test('resume reader rejects the same path on another origin before diagnostics', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); }
  catch { t.skip('Local Chromium is unavailable'); return; }
  try {
    const page = await browser.newPage();
    await page.route('https://other.example/resume/fixture123', route => route.fulfill({ status: 200,
      contentType: 'text/html; charset=utf-8', body: '<main><h1>Private title</h1></main>' }));
    await page.goto('https://other.example/resume/fixture123');
    const output = await captureFailure(() => readResumeContent(page, 'fixture123'));
    assert.equal(output, 'JOB_HH_RESUME_READ_FAILURE wrong_page\n');
    await page.close();
  } finally { await browser.close(); }
});


const statePage = (resumeId, state, extraTemplate = '') => `<main><h1>Heading</h1></main>
  <template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>${extraTemplate}`;
const validState = (title = 'Product Manager') => ({ applicantResume: {
  title: [{ string: title }], skills: [{ string: 'Analytics' }],
  experience: [{ position: 'Lead', description: 'Built reporting', id: 42 }],
} });

const completeState = (id = 'fixture123') => ({ applicantResume: {
  _attributes: { hash: id }, hiddenFields: [], title: [{ string: 'Разработчик AI-систем' }],
  experience: [
    { position: 'Разработчик', companyName: 'Команда А', startDate: '2023-01-01', endDate: '2024-02-01', description: 'Создал голосовой интерфейс' },
    { position: 'Инженер', companyName: 'Команда Б', startDate: '2024-03-01', endDate: null, description: 'Собрал LLM routing' },
  ],
  keySkills: [{ string: 'Node.js' }, { string: 'PostgreSQL' }],
  resumeApplicantSkills: [{ name: 'API design', level: null }, { name: 'PostgreSQL', level: { id: 'advanced', name: 'Продвинутый', rank: 3 } }],
  skills: [{ string: 'Разрабатываю настольную AI-систему' }],
  educationLevel: [{ string: 'Высшее' }],
  primaryEducation: [{ name: 'Университет', organization: 'Факультет ИТ', result: 'Программная инженерия', year: 2021, educationLevel: 'Высшее' }],
  elementaryEducation: [{ name: 'Школа', year: 2017 }],
  additionalEducation: [], attestationEducation: [], certificate: [], externalCertificates: [],
  availableExternalCertificates: [], language: [{ id: 57, degree: 'B2' }],
  employment: [{ string: 'full' }], employmentForms: [], workFormats: [], workSchedule: [],
  relocation: [], businessTripReadiness: [], travelTime: [],
  email: [{ string: 'hidden@example.com' }], phone: [{ formatted: '+7 999 123-45-67' }],
} });

test('bound HH editor state yields complete career history without contacts', async t => withBrowser(t, async browser => {
  const page = await browser.newPage();
  await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200,
    contentType: 'text/html; charset=utf-8', body: `<main><h1>Разработчик AI-систем</h1>
      <div data-qa="resume-list-card-experience"></div><div data-qa="resume-about-card"></div></main>
      <template id="HH-Lux-InitialState">${JSON.stringify(completeState())}</template>` }));
  await page.goto('https://hh.ru/resume/fixture123');
  const resume = await readResumeContent(page, 'fixture123', { requireComplete: true });
  assert.match(resume.experience, /Команда А[\s\S]*2023-01-01[\s\S]*голосовой/);
  assert.match(resume.experience, /Команда Б[\s\S]*2024-03-01[\s\S]*LLM routing/);
  assert.match(resume.skills, /Node.js, PostgreSQL, API design/);
  assert.match(resume.skills, /PostgreSQL \(уровень: Продвинутый\)/);
  assert.match(resume.education, /Высшее[\s\S]*Университет[\s\S]*Факультет ИТ[\s\S]*Школа/);
  assert.match(resume.summary, /настольную AI-систему[\s\S]*Английский · B2/);
  assert.doesNotMatch(JSON.stringify(resume), /hidden@example|999 123|"email"|"phone"/);
  await page.close();
}));

test('complete HH state requires exact binding and typed career coverage', async t => withBrowser(t, async browser => {
  const page = await browser.newPage(); let state = completeState();
  await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200,
    contentType: 'text/html; charset=utf-8', body: `<main><h1>Разработчик AI-систем</h1></main>
      <template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>` }));
  const mutate = [
    value => { value._attributes.hash = 'other'; },
    value => { value.hiddenFields.push('experience'); },
    value => { delete value.primaryEducation; },
    value => { delete value.resumeApplicantSkills; },
    value => { value.resumeApplicantSkills[1].name = null; },
    value => { value.resumeApplicantSkills[1].level = { other: 'unknown' }; },
    value => { value.experience[1].startDate = '2024-02-31'; },
    value => { value.experience[1].endDate = '2023-01-01'; },
    value => { value.primaryEducation[0].educationLevel = {}; },
    value => { value.skills[0].string = 'Контактные данные: hidden@example.com'; },
    value => { value.experience[1].description = 42; },
    value => { value.certificate.push({ title: 'Unknown schema' }); },
  ];
  for (const change of mutate) {
    state = completeState(); change(state.applicantResume);
    await page.goto('https://hh.ru/resume/fixture123');
    await assert.rejects(readResumeContent(page, 'fixture123', { requireComplete: true }),
      { code: 'JOB_HH_RESUME_UNAVAILABLE' });
  }
  state = completeState(); state.applicantResume.primaryEducation = []; state.applicantResume.elementaryEducation = []; state.applicantResume.educationLevel = []; state.applicantResume.skills = [];
  await page.goto('https://hh.ru/resume/fixture123');
  const blankOptional = await readResumeContent(page, 'fixture123', { requireComplete: true });
  assert.equal(blankOptional.education, ''); assert.equal(blankOptional.summary.includes('настольную'), false);
  await page.close();
}));

test('autonomous reading refuses partial visible resumes instead of silently dropping sections', async t => withBrowser(t, async browser => {
  const page = await browser.newPage();
  await page.route('https://hh.ru/resume/partial123', route => route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:
    '<main><h1>Developer</h1><section><h2>Обо мне</h2><p>Personal project</p></section></main>'}));
  await page.goto('https://hh.ru/resume/partial123');
  assert.equal((await readResumeContent(page,'partial123')).summary.includes('Personal project'),true);
  await assert.rejects(readResumeContent(page,'partial123',{requireComplete:true}),{code:'JOB_HH_RESUME_UNAVAILABLE'});
}));

async function withBrowser(t, run) {
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); }
  catch { t.skip('Local Chromium is unavailable'); return; }
  try { await run(browser); } finally { await browser.close(); }
}

test('SSR fallback extracts every supported entry and keeps selected profiles separate', async t => withBrowser(t, async browser => {
  const profiles = [
    { id: 'alpha123', title: 'Analyst', skill: 'SQL', role: 'Researcher' },
    { id: 'beta456', title: 'Designer', skill: 'Figma', role: 'Artist' },
  ];
  await Promise.all(profiles.map(async profile => {
    const page = await browser.newPage();
    const state = { nested: validState(profile.title) };
    state.nested.applicantResume.title.push({ string: 'Senior' });
    state.nested.applicantResume.skills.push({ string: profile.skill });
    state.nested.applicantResume.experience.push({ position: profile.role, description: 'Second period' });
    await page.route(`https://hh.ru/resume/${profile.id}`, route => route.fulfill({ status: 200,
      contentType: 'text/html; charset=utf-8', body: statePage(profile.id, state) }));
    await page.goto(`https://hh.ru/resume/${profile.id}`);
    const snapshot = await readResumeContent(page, profile.id);
    assert.equal(snapshot.resumeId, profile.id);
    assert.equal(snapshot.title, `${profile.title} Senior`);
    assert.match(snapshot.skills, new RegExp(profile.skill));
    assert.match(snapshot.experience, new RegExp(profile.role));
    assert.match(snapshot.experience, /Built reporting[\s\S]*Second period/);
    assert.equal(snapshot.education, '');
    await assert.rejects(readResumeContent(page, profile.id, { requireComplete: true }), { code: 'JOB_HH_RESUME_UNAVAILABLE' });
    await page.close();
  }));
}));

test('SSR fallback rejects ambiguous, incomplete, unsupported and private states with closed reasons', async t => withBrowser(t, async browser => {
  const page = await browser.newPage();
  let body = '';
  await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200,
    contentType: 'text/html; charset=utf-8', body }));
  const valid = validState();
  const cases = [
    [statePage('fixture123', valid, '<template id="HH-Lux-InitialState">{}</template>'), 'ssr_template'],
    [statePage('fixture123', { one: valid, two: valid }), 'ssr_ambiguous'],
    [statePage('fixture123', { deep: Array.from({ length: 65 }).reduceRight(child => ({ child }), valid) }), 'ssr_incomplete'],
    [statePage('fixture123', { children: Array.from({ length: 20001 }, () => ({})) }), 'ssr_incomplete'],
    [statePage('fixture123', { applicantResume: { ...valid.applicantResume, skills: [{ string: 'Good' }, { other: 'private' }] } }), 'ssr_shape'],
    [statePage('fixture123', { applicantResume: { ...valid.applicantResume, title: [{ string: 'Good', extra: 'private' }] } }), 'ssr_shape'],
    [statePage('fixture123', { applicantResume: { ...valid.applicantResume, experience: [
      ...valid.applicantResume.experience, { position: 'Lead', description: 42 }] } }), 'ssr_shape'],
    [statePage('fixture123', { applicantResume: { ...valid.applicantResume, skills: [{ string: 'secret@example.com' }] } }), 'private_content'],
    [statePage('fixture123', { applicantResume: { ...valid.applicantResume, experience: [
      { position: 'Lead', description: 'secret@example.com' }] } }), 'private_content'],
    [statePage('fixture123', { applicantResume: { ...valid.applicantResume, title: [{ string: 'x'.repeat(12001) }] } }), 'ssr_shape'],
  ];
  for (const [html, reason] of cases) {
    body = html;
    await page.goto('https://hh.ru/resume/fixture123');
    const output = await captureFailure(() => readResumeContent(page, 'fixture123'));
    assert.equal(output, `JOB_HH_RESUME_READ_FAILURE ${reason}\n`);
    assert.doesNotMatch(output, /secret@example|fixture123|Good/);
  }
  body = `<main><h1>Heading</h1></main><template id="HH-Lux-InitialState">${'x'.repeat(1048577)}</template>`;
  await page.goto('https://hh.ru/resume/fixture123');
  assert.equal(await captureFailure(() => readResumeContent(page, 'fixture123')),
    'JOB_HH_RESUME_READ_FAILURE ssr_size\n');
  await page.close();
}));

test('SSR fallback rejects a different path on the same origin', async t => withBrowser(t, async browser => {
  const page = await browser.newPage();
  await page.route('https://hh.ru/resume/other', route => route.fulfill({ status: 200,
    contentType: 'text/html; charset=utf-8', body: statePage('other', validState()) }));
  await page.goto('https://hh.ru/resume/other');
  assert.equal(await captureFailure(() => readResumeContent(page, 'fixture123')),
    'JOB_HH_RESUME_READ_FAILURE wrong_page\n');
  await page.close();
}));
