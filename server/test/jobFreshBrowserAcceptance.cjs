// Explicit integration: requires job-browser Playwright, Edge/Chromium, and an isolated PostgreSQL fixture.
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
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');

test('fresh Chromium → RPC → PostgreSQL: shared filters, independent progress, rolling head and dedup', async () => {
  const f = await createJobPostgresFixture(); let browser, context, rpc;
  let now = new Date('2026-10-25T12:00:00.000Z'); let writes = 0, searchReads = 0;
  let currentIds = ['201', '202', '203'];
  const fixtures = {
    201: { title: 'Junior AI Engineer', publishedAt: '2026-10-25T11:58:00Z', description: 'Backend engineering' },
    202: { title: 'AI Engineer', publishedAt: '2026-10-25T09:00:00Z', description: 'Backend engineering' },
    203: { title: 'AI Sales Manager', publishedAt: '2026-10-25T11:59:00Z', description: 'Sales role' },
    204: { title: 'AI Platform Engineer', publishedAt: '2026-10-25T12:04:00Z', description: 'Platform engineering' },
  };
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true,
      ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes++; return route.abort(); }
      if (url.origin !== 'https://hh.ru') return route.abort();
      let body;
      if (url.pathname === '/search/vacancy') {
        searchReads++;
        assert.equal(url.searchParams.get('text'), 'AI Engineer');
        assert.equal(url.searchParams.get('order_by'), 'publication_time');
        assert.equal(url.searchParams.get('items_on_page'), '20');
        assert.equal(url.searchParams.get('date_from'), '25.10.2026');
        assert.equal(url.searchParams.get('date_to'), '25.10.2026');
        body = `<h1>${currentIds.length} вакансии</h1>${currentIds.map(id =>
          `<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/${id}">Fixture</a></div>`).join('')}`;
      } else {
        const id = url.pathname.split('/').pop(), item = fixtures[id];
        if (!item) return route.fulfill({ status: 404, body: '' });
        body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: item.title,
          datePosted: item.publishedAt, hiringOrganization: { name: 'Fixture' },
          jobLocation: { address: { addressLocality: 'Москва' } } })}</script>
          <div data-qa="vacancy-description">${item.description}</div>
          <div data-qa="work-formats-text">Формат работы: В офисе</div>`;
      }
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body>${body}</body></html>` });
    });
    const token = randomBytes(32).toString('hex');
    rpc = createRpcServer({ ownerId: f.owner, token, browser: new HhBrowser({ context, now: () => now }) });
    rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
    const client = new JobBrowserClient({ ownerId: f.owner, token,
      baseUrl: `http://127.0.0.1:${rpc.address().port}`, allowTestHttp: true });
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const history = new JobSearchRepository(f.pool, { accessService });
    const fresh = new JobSearchRepository(f.pool, { accessService, lane: 'fresh' });
    const delivery = new JobDeliveryRepository(f.pool, { accessService });
    const initial = await history.ensure({ scope: f.scope });
    const configured = await history.saveSettings({ scope: f.scope, expectedRevision: initial.revision,
      settings: { ...initial.settings, queries: ['AI Engineer'], exclusions: ['Sales'], activated: true, paused: false } });
    const oldProgress = { lower: '2026-10-11T12:00:00.000Z', until: '2026-10-25T11:00:00.000Z',
      windows: [{ query: 'AI Engineer', from: '2026-10-11T12:00:00.000Z',
        to: '2026-10-25T11:00:00.000Z', page: 4, offset: 7 }] };
    await f.pool.query('UPDATE job_searches SET progress=$1 WHERE user_id=$2', [oldProgress, f.owner]);
    const run = () => new JobCollector({ searchRepository: fresh, deliveryRepository: delivery, hhClient: client,
      lane: 'fresh', now: () => now, wait: async () => {} }).runOnce({ userId: f.owner, now, force: true });

    assert.equal((await run()).outcome, 'complete');
    let state = await history.getSettings({ userId: f.owner });
    assert.deepEqual(state.progress, oldProgress, 'historical checkpoint and offset remain intact');
    assert.equal(state.fresh_checkpoint.toISOString(), now.toISOString());
    let deliveries = (await f.pool.query(`SELECT v.external_id,d.status FROM job_deliveries d
      JOIN job_vacancies v ON v.id=d.vacancy_id WHERE d.kind='card' ORDER BY v.external_id`)).rows;
    assert.deepEqual(deliveries, [{ external_id: '201', status: 'queued' }],
      'only a new matching vacancy is delivered; old and excluded results are discarded');

    const first = await delivery.claim(); assert.ok(first, 'the fresh vacancy is available to the existing delivery worker');
    await delivery.finish({ deliveryId: first.id, outcome: 'sent', telegramMessageId: 'fixture-1' });

    now = new Date('2026-10-25T12:05:00.000Z'); currentIds = ['201', '202', '203', '204'];
    assert.equal((await run()).outcome, 'complete', 'the five-minute follow-up search completes');
    state = await history.getSettings({ userId: f.owner });
    assert.deepEqual(state.progress, oldProgress);
    assert.equal(state.fresh_checkpoint.toISOString(), now.toISOString());
    deliveries = (await f.pool.query(`SELECT v.external_id,d.status FROM job_deliveries d
      JOIN job_vacancies v ON v.id=d.vacancy_id WHERE d.kind='card' ORDER BY v.external_id`)).rows;
    assert.deepEqual(deliveries, [{ external_id: '201', status: 'sent' }, { external_id: '204', status: 'queued' }],
      'new head arrives, while confirmed delivery is retained without replay');
    assert.equal((await f.pool.query('SELECT revision FROM job_searches WHERE user_id=$1', [f.owner])).rows[0].revision,
      configured.revision, 'fresh monitoring does not mutate filters or their revision');
    assert.equal(searchReads, 2, 'each scheduled run reads the search page');
    assert.equal(writes, 0, 'collection sends no changing request to HH');
  } finally {
    if (rpc) await new Promise(resolve => rpc.close(resolve));
    await context?.close(); await browser?.close(); await f.close();
  }
});
