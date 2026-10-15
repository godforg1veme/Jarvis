// Explicit acceptance: node --test test/hhBrowserAcceptance.cjs in the pinned Chromium image.
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { HhBrowser } = require('../src/hhBrowser');

test('real Chromium reads fixtures, rejects changed/security pages, and never makes a write', async () => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let writes = 0;
  let hiddenResume = true, questionnaire = false;
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes++; return route.abort(); }
    if (url.origin !== 'https://hh.ru') return route.abort();
    let body, status = 200;
    if (url.pathname === '/search/vacancy') {
      assert.equal(url.searchParams.get('items_on_page'), '20');
      assert.equal(url.searchParams.has('date_from'), false);
      const query = url.searchParams.get('text');
      const page = Number(url.searchParams.get('page'));
      const cards = Array.from({ length: page ? 1 : 20 }, (_, index) =>
        `<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/${page ? 121 : 101 + index}">Fixture</a></div>`).join('');
      body = query === 'zero' ? '<h1>По запросу «Fixture» ничего не найдено</h1><div data-qa="empty-vacancy-search-block">Ничего не нашлось</div>' : query === 'captcha' ? '<h1>Подтвердите, что вы не робот</h1>'
        : query === 'changed' ? '<h1>Изменилась страница</h1>'
          : `<h1>21 вакансия</h1>${cards}<a data-qa="pager-page" href="/search/vacancy?page=1">2</a>`;
    } else if (url.pathname === '/vacancy/404') { status = 404; body = 'Не найдено'; }
    else if (url.pathname === '/applicant/vacancy_response') {
      body = `<div data-qa="resume-title">Первое резюме</div>
        <div data-qa="hidden-resume-warning" ${hiddenResume ? '' : 'style="width:0;height:0;overflow:hidden"'}>Измените видимость резюме</div>
        <form><input type="hidden" name="_xsrf" value="fixture"><button data-qa="vacancy-response-letter-toggle" type="button">Добавить письмо</button>
        ${questionnaire ? '<input type="text" name="questionnaire">' : ''}
        <button data-qa="vacancy-response-submit-popup" type="submit">Откликнуться</button></form>`;
    } else if (url.pathname.startsWith('/vacancy/')) {
      body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Junior AI',
        datePosted: '2026-10-15T10:00:00+03:00', hiringOrganization: { name: 'Fixture' } })}</script>
        <div data-qa="vacancy-description">Автоматизация и AI</div>
        <div data-qa="vacancy-company"><a href="/employer/${url.pathname === '/vacancy/102' ? '1001' : '900'}">Fixture</a></div>
        <script>fetch('/unexpected-write',{method:'POST',body:'fixture'}).catch(()=>{});</script>`;
    } else if (url.pathname === '/applicant/resumes') {
      body = '<h1>Мои резюме</h1><div data-qa="resume"><a data-qa="resume-title" href="/resume/fixtureA">Первое резюме</a></div>';
    } else if (url.pathname === '/resume/fixtureA') {
      body = `<button type="button" data-qa="resume-visibility-card">Скрыто от выбранных работодателей</button>
      <script>document.querySelector('button').onclick=()=>{
        document.body.insertAdjacentHTML('beforeend','<label data-qa="resume-visibility-card-access-type-blacklist"><input type="radio" checked></label><button type="button" data-qa="applicant-employers-list-activator-blacklist">Список</button>');
        document.querySelector('[data-qa="applicant-employers-list-activator-blacklist"]').onclick=()=>{
          const rows=['1001','1002'].map(id=>'<div><div><div><div data-qa="resume-editor-employer-list-item-'+id+'"><a href="/employer/'+id+'">Fixture</a></div></div></div><button type="button" data-qa="resume-employer-list-item-delete"></button></div>').join('');
          document.body.insertAdjacentHTML('beforeend','<div role="dialog"><input data-qa="resume-editor-employer-list-search-input"><div data-qa="modal-content-scroll-container">'+rows+'</div><button data-qa="resume-modal-button-save">Готово</button></div>');
        };
      };</script>`;
    } else { status = 404; body = ''; }
    await route.fulfill({ status, contentType: 'text/html; charset=utf-8', body: `<!DOCTYPE html><html><body>${body}</body></html>` });
  });
  try {
    const hh = new HhBrowser({ context, primaryResumeId: 'fixtureA', now: () => new Date('2026-10-15T12:00:00Z') });
    const args = { query: 'AI', publishedFrom: '2026-10-01T12:00:00Z', publishedTo: '2026-10-15T12:00:00Z' };
    const first = await hh.search(args); assert.equal(first.items.length, 20); assert.equal(first.pages, 2);
    assert.equal((await hh.search({ ...args, page: 1 })).items[0].id, '121');
    assert.equal((await hh.search({ ...args, query: 'zero' })).found, 0);
    await assert.rejects(hh.search({ ...args, query: 'captcha' }), { code: 'JOB_HH_CAPTCHA_REQUIRED' });
    await assert.rejects(hh.search({ ...args, query: 'changed' }), { code: 'JOB_HH_DOM_CHANGED' });
    await assert.rejects(hh.getVacancy({ externalId: '404' }), { code: 'JOB_HH_NOT_FOUND' });
    const vacancy = await hh.getVacancy({ externalId: '101' });
    assert.equal(vacancy.title, 'Junior AI'); assert.equal(vacancy.publishedAt, '2026-10-15T07:00:00.000Z');
    assert.equal(vacancy.salary, null);
    assert.deepEqual(await hh.listResumes(), [{ id: 'fixtureA', title: 'Первое резюме' }]);
    assert.equal((await hh.inspect({ externalId: '101', resumeId: 'fixtureA' })).reasonCode, 'JOB_HH_RESUME_HIDDEN');
    hiddenResume = false;
    assert.equal((await hh.inspect({ externalId: '101', resumeId: 'fixtureA' })).manualRequired, false);
    questionnaire = true;
    assert.equal((await hh.inspect({ externalId: '101', resumeId: 'fixtureA' })).manualRequired, true);
    assert.equal((await hh.inspect({ externalId: '102', resumeId: 'fixtureA' })).reasonCode, 'JOB_HH_EMPLOYER_BLOCKED');
    await assert.rejects(hh.inspect({ externalId: '101', resumeId: 'fixtureB' }), { code: 'JOB_HH_RESUME_UNAVAILABLE' });
    assert.equal(writes, 0, 'page-level read guard blocks writes before any transport');
  } finally { await context.close(); await browser.close(); }
});
