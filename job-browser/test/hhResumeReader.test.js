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
