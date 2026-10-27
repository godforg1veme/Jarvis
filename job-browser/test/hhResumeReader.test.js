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

test('page diagnostics distinguish missing structure without logging page text', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); }
  catch { t.skip('Local Chromium is unavailable'); return; }
  try {
    const page = await browser.newPage();
    let body = '';
    await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200,
      contentType: 'text/html; charset=utf-8', body }));
    const cases = [
      ['<div>secret@example.com</div>', 'main_missing'],
      ['<main><p>secret@example.com</p></main>', 'title_count'],
      ['<main><h1>Role</h1><section><h2>Опыт</h2><p>x</p><h2>Опыт</h2></section></main>', 'duplicate_section'],
      ['<main><h1>Role</h1><h2>Опыт</h2></main>', 'section_container'],
    ];
    for (const [html, reason] of cases) {
      body = html;
      await page.goto('https://hh.ru/resume/fixture123');
      const output = await captureFailure(() => readResumeContent(page, 'fixture123'));
      assert.equal(output, `JOB_HH_RESUME_READ_FAILURE ${reason}\n`);
      assert.doesNotMatch(output, /secret|fixture123|Role|Опыт/);
    }
    await page.close();
  } finally { await browser.close(); }
});

test('empty content reports only fixed structure booleans from alternate tags', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); }
  catch { t.skip('Local Chromium is unavailable'); return; }
  try {
    const page = await browser.newPage();
    await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200,
      contentType: 'text/html; charset=utf-8', body: `<main><h1>Secret Name</h1>
        <div data-qa="resume-block-experience"><span>Опыт работы · secret@example.com</span></div>
        <p data-qa="resume-block-education">Образование: sensitive detail</p>
        <strong>Ключевые навыки: private text</strong>
        <em>Обо мне: private text</em>
        <div data-qa="untrusted-secret-attribute">secret@example.com</div></main>` }));
    await page.goto('https://hh.ru/resume/fixture123');
    const output = await captureFailure(() => readResumeContent(page, 'fixture123'));
    assert.match(output, /^JOB_HH_RESUME_STRUCTURE 10101111\nJOB_HH_RESUME_DOM visited=7 visible=7 leaf=6 tags=P,MAIN,OTHER,OTHER,NONE,NONE qa=EDUCATION,NONE,NONE,NONE,NONE,NONE\nJOB_HH_RESUME_EDUCATION 6:1:111\|[0-9]+:[01]:111\|[0-9]+:[01]:111\|0:0:000\|0:0:000\nJOB_HH_RESUME_INITIAL_STATE 0010000000\nJOB_HH_RESUME_READ_FAILURE empty_content\n$/);
    assert.doesNotMatch(output, /Secret Name|secret|fixture123|private text|sensitive detail|untrusted/);
    await page.close();
  } finally { await browser.close(); }
});

test('empty content maps unknown tags and data-qa values to closed types', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); }
  catch { t.skip('Local Chromium is unavailable'); return; }
  try {
    const page = await browser.newPage();
    await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200,
      contentType: 'text/html; charset=utf-8', body: `<main><h1>Secret Name</h1>
        <article data-qa="resume-visibility-card"><section data-qa="resume-block-education">
        <custom-heading data-qa="private-leaf-token">Образование secret@example.com</custom-heading>
        <div style="display:none">Private text after heading</div></section></article></main>` }));
    await page.goto('https://hh.ru/resume/fixture123');
    const output = await captureFailure(() => readResumeContent(page, 'fixture123'));
    assert.match(output, /^JOB_HH_RESUME_STRUCTURE 00100010\nJOB_HH_RESUME_DOM visited=5 visible=4 leaf=2 tags=OTHER,SECTION,ARTICLE,MAIN,OTHER,OTHER qa=OTHER,EDUCATION,OTHER,NONE,NONE,NONE\nJOB_HH_RESUME_EDUCATION 1:0:000\|1:0:000\|2:0:000\|[0-9]+:0:000\|[0-9]+:0:000\nJOB_HH_RESUME_INITIAL_STATE 0010000000\nJOB_HH_RESUME_READ_FAILURE empty_content\n$/);
    assert.doesNotMatch(output, /Secret Name|secret|fixture123|private|token|custom-heading|example.com|VISIBILITY|ACCESS/);
    await page.close();
  } finally { await browser.close(); }
});

test('bounded initial state probe reports only allowlisted presence bits', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); }
  catch { t.skip('Local Chromium is unavailable'); return; }
  try {
    const page = await browser.newPage();
    let stateText = '';
    await page.route('https://hh.ru/resume/fixture123', route => route.fulfill({ status: 200,
      contentType: 'text/html; charset=utf-8', body: `<main><h1>Secret Name</h1></main>
        <template id="HH-Lux-InitialState">${stateText}</template>` }));
    const cases = [
      [{ parent: { applicantResume: { experience: 'secret@example.com', education: 'private', skills: [],
        skillSet: [], title: 'Private Title', id: 'private-id' } } }, '1111111111'],
      [{ parent: { applicantResume: { education: 'secret@example.com', id: 'private-id' } } }, '1111010001'],
      ['x'.repeat(1048577), '1000000000'],
      [JSON.stringify('я'.repeat(600000)), '1000000000'],
      [Array.from({ length: 9 }).reduceRight((child) => ({ nested: child }), { applicantResume: { id: 'private-id' } }), '1100000000'],
      [{ children: Array.from({ length: 3001 }, () => ({})) }, '1100000000'],
    ];
    for (const [value, expected] of cases) {
      stateText = typeof value === 'string' ? value : JSON.stringify(value);
      await page.goto('https://hh.ru/resume/fixture123');
      const output = await captureFailure(() => readResumeContent(page, 'fixture123'));
      assert.match(output, new RegExp(`^JOB_HH_RESUME_STRUCTURE [01]{8}\\nJOB_HH_RESUME_DOM [^\\n]+\\nJOB_HH_RESUME_EDUCATION [0-9:|]+\\nJOB_HH_RESUME_INITIAL_STATE ${expected}\\nJOB_HH_RESUME_READ_FAILURE empty_content\\n$`));
      assert.doesNotMatch(output, /secret|private-id|Private Title|Secret Name|nested|parent|children/);
    }
    await page.close();
  } finally { await browser.close(); }
});
