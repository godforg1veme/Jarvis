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
