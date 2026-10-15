// Explicit integration: requires job-browser/npm ci, Chromium (or PLAYWRIGHT_CHANNEL), and the isolated PG fixture URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { chromium } = require('../../job-browser/node_modules/playwright');
const { HhBrowser } = require('../../job-browser/src/hhBrowser');
const { createRpcServer } = require('../../job-browser/src/rpcServer');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { JobCollector } = require('../src/jobs/jobCollector');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');

test('Chromium → authenticated RPC → collector → real PG: salary/location filters, interrupted progress and dedup', async () => {
  const f = await createJobPostgresFixture(); let browser, context, rpc;
  const now = new Date('2026-10-15T12:00:00Z'); let writes = 0;
  const fixtures = {
    101: { title: 'Junior AI Engineer', city: 'Москва', format: 'на месте работодателя', salary: 'от 120 000 ₽ за месяц, на руки' },
    102: { title: 'AI QA Engineer', city: 'Санкт-Петербург', format: 'на месте работодателя' },
    103: { title: 'Менеджер по продажам AI', city: 'Москва', format: 'на месте работодателя' },
    104: { title: 'Junior LLM Engineer', city: '', format: 'Удалённо' },
    105: { title: 'AI Intern', city: 'Москва', format: 'на месте работодателя', salary: 'до 90 000 ₽ за месяц, на руки' },
  };
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true,
      ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes++; return route.abort(); }
      if (url.origin !== 'https://hh.ru') return route.abort();
      let body;
      if (url.pathname === '/search/vacancy') {
        assert.equal(url.searchParams.get('items_on_page'), '20');
        body = `<h1>5 вакансий</h1>${Object.keys(fixtures).map((id) => `<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/${id}">Fixture</a></div>`).join('')}`;
      } else {
        const value = fixtures[url.pathname.split('/').pop()];
        if (!value) return route.fulfill({ status: 404, body: '' });
        body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: value.title,
          datePosted: '2026-10-14T10:00:00+03:00', hiringOrganization: { name: 'Fixture' },
          jobLocation: { address: { addressLocality: value.city } } })}</script>
          <div data-qa="vacancy-description">Разработка AI и автоматизация</div>
          <div data-qa="work-formats-text">Формат работы: ${value.format}</div>
          ${value.salary ? `<div data-qa="vacancy-salary">${value.salary}</div>` : ''}`;
      }
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!DOCTYPE html><html><body>${body}</body></html>` });
    });
    const token = randomBytes(32).toString('hex');
    rpc = createRpcServer({ ownerId: f.owner, token, browser: new HhBrowser({ context, now: () => now }) });
    rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
    const client = new JobBrowserClient({ ownerId: f.owner, token, baseUrl: `http://127.0.0.1:${rpc.address().port}`, allowTestHttp: true });
    const search = new JobSearchRepository(f.pool), delivery = new JobDeliveryRepository(f.pool);
    const initial = await search.ensure({ scope: f.scope });
    await search.saveSettings({ scope: f.scope, expectedRevision: initial.revision,
      settings: { ...initial.settings, queries: ['AI Engineer'], activated: true } });
    const run = (maxRequests = 500) => new JobCollector({ searchRepository: search, deliveryRepository: delivery, hhClient: client,
      now: () => now, wait: async () => {}, maxRequests }).runOnce({ userId: f.owner, now, force: true });
    assert.equal((await run(3)).outcome, 'JOB_COLLECTION_LIMIT');
    assert.equal((await search.getSettings({ userId: f.owner })).progress.windows[0].offset, 2);
    assert.equal((await run()).outcome, 'complete');
    const rows = (await f.pool.query('SELECT v.external_id FROM job_deliveries d JOIN job_vacancies v ON v.id=d.vacancy_id ORDER BY v.external_id')).rows;
    assert.deepEqual(rows.map((row) => row.external_id), ['101', '104']);
    assert.equal((await run()).outcome, 'complete');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 2);
    assert.equal((await search.getSettings({ userId: f.owner })).progress, null);
    assert.equal(writes, 0);
  } finally {
    if (rpc) await new Promise((resolve) => rpc.close(resolve));
    await context?.close(); await browser?.close(); await f.close();
  }
});
