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

test('daily reconciliation: Edge → authenticated RPC → disposable PostgreSQL finds late-indexed old vacancies', async () => {
  const f = await createJobPostgresFixture(); let browser, context, rpc;
  let now = new Date('2026-10-26T12:00:00.000Z'); let writes = 0, searchReads = 0;
  let currentIds = ['301'];
  const fixtures = {
    301: { title: 'Fixture Backend Engineer', publishedAt: '2026-10-20T12:00:00Z', description: 'Backend engineering' },
    302: { title: 'Fixture Platform Engineer', publishedAt: '2026-10-19T09:00:00Z', description: 'Platform engineering' },
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
        assert.equal(url.searchParams.get('text'), 'Fixture');
        assert.equal(url.searchParams.get('order_by'), 'publication_time');
        assert.equal(url.searchParams.get('items_on_page'), '20');
        assert.equal(url.searchParams.get('date_from'), searchReads === 1 ? '12.10.2026' : '13.10.2026');
        assert.equal(url.searchParams.get('date_to'), searchReads === 1 ? '26.10.2026' : '27.10.2026');
        body = `<h1>${currentIds.length} вакансии</h1>${currentIds.map(id =>
          `<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/${id}">Fixture vacancy</a></div>`).join('')}`;
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
    const reconcile = new JobSearchRepository(f.pool, { accessService, lane: 'reconcile' });
    const delivery = new JobDeliveryRepository(f.pool, { accessService });
    const initial = await history.ensure({ scope: f.scope });
    const configured = await history.saveSettings({ scope: f.scope, expectedRevision: initial.revision,
      settings: { ...initial.settings, queries: ['Fixture'], exclusions: ['Sales'], historyDays: 14, activated: true, paused: false } });
    const historyProgress = { lower: '2026-10-12T12:00:00.000Z', until: '2026-10-26T11:00:00.000Z',
      windows: [{ query: 'Fixture', from: '2026-10-12T12:00:00.000Z', to: '2026-10-26T11:00:00.000Z', page: 4, offset: 7 }] };
    const freshProgress = { lower: '2026-10-26T11:00:00.000Z', until: '2026-10-26T11:00:00.000Z',
      windows: [{ query: 'Fixture', from: '2026-10-26T11:00:00.000Z', to: '2026-10-26T12:00:00.000Z', page: 1, offset: 2 }] };
    const reconciliationCheckpoint = new Date('2026-10-26T11:30:00.000Z');
    await f.pool.query(`UPDATE job_searches SET checkpoint=$1,fresh_checkpoint=$1,reconciliation_checkpoint=$2,
      progress=$3,fresh_progress=$4,reconciliation_next_check_at=$5 WHERE user_id=$6`,
      ['2026-10-26T11:00:00.000Z', reconciliationCheckpoint, historyProgress, freshProgress,
        '2026-10-26T11:45:00.000Z', f.owner]);
    const run = (at = now) => new JobCollector({ searchRepository: reconcile, deliveryRepository: delivery,
      hhClient: client, lane: 'reconcile', now: () => at, wait: async () => {} })
      .runOnce({ userId: f.owner, now: at, force: true });

    assert.equal((await run()).outcome, 'complete');
    let state = await history.getSettings({ userId: f.owner });
    assert.deepEqual(state.progress, historyProgress, 'historical scan progress is independent');
    assert.deepEqual(state.fresh_progress, freshProgress, 'fresh scan progress is independent');
    assert.equal(state.checkpoint.toISOString(), '2026-10-26T11:00:00.000Z');
    assert.equal(state.fresh_checkpoint.toISOString(), '2026-10-26T11:00:00.000Z');
    assert.equal(state.reconciliation_checkpoint.toISOString(), now.toISOString());
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-27T12:00:00.000Z');
    let cards = (await f.pool.query(`SELECT v.external_id,d.status,d.priority FROM job_deliveries d
      JOIN job_vacancies v ON v.id=d.vacancy_id WHERE d.kind='card' ORDER BY v.external_id`)).rows;
    assert.deepEqual(cards, [{ external_id: '301', status: 'queued', priority: 0 }],
      'full-range pass catches a previously missed vacancy published days ago at reconciliation priority');
    const first = await delivery.claim(); assert.ok(first);
    await delivery.finish({ deliveryId: first.id, outcome: 'sent', telegramMessageId: 'fixture-reconcile-1' });

    now = new Date('2026-10-27T12:00:00.000Z'); currentIds = ['301', '302'];
    assert.equal((await run()).outcome, 'complete', 'the next daily cycle reads the updated HH listing');
    state = await history.getSettings({ userId: f.owner });
    assert.deepEqual(state.progress, historyProgress);
    assert.deepEqual(state.fresh_progress, freshProgress);
    assert.equal(state.checkpoint.toISOString(), '2026-10-26T11:00:00.000Z');
    assert.equal(state.fresh_checkpoint.toISOString(), '2026-10-26T11:00:00.000Z');
    assert.equal(state.reconciliation_checkpoint.toISOString(), now.toISOString());
    assert.equal(state.reconciliation_next_check_at.toISOString(), '2026-10-28T12:00:00.000Z');
    cards = (await f.pool.query(`SELECT v.external_id,d.status,d.priority FROM job_deliveries d
      JOIN job_vacancies v ON v.id=d.vacancy_id WHERE d.kind='card' ORDER BY v.external_id`)).rows;
    assert.deepEqual(cards, [
      { external_id: '301', status: 'sent', priority: 0 },
      { external_id: '302', status: 'queued', priority: 0 },
    ], 'late-indexed old vacancy is found and the previously sent card is not replayed');
    assert.equal((await f.pool.query('SELECT revision FROM job_searches WHERE user_id=$1', [f.owner])).rows[0].revision,
      configured.revision, 'reconciliation reuses filters without changing their revision');
    assert.equal(searchReads, 2, 'each daily cycle performs one full-range HH search');
    assert.equal(writes, 0, 'all HH requests were read-only; the fixture makes no Bot API requests');
  } finally {
    if (rpc) await new Promise(resolve => rpc.close(resolve));
    await context?.close(); await browser?.close(); await f.close();
  }
});

test('30-day reconciliation keeps exact detail bounds while HH receives a non-expired calendar date', async () => {
  const f = await createJobPostgresFixture(); let browser, context, rpc;
  const collectorNow = new Date('2026-10-26T12:00:00.000Z');
  const lower = new Date(collectorNow.getTime() - 30 * 86400000);
  const browserNow = new Date(collectorNow.getTime() + 60000);
  let writes = 0, searchReads = 0;
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
        assert.equal(url.searchParams.get('text'), 'Fixture');
        assert.equal(url.searchParams.get('date_from'), '26.09.2026', 'wire lower bound uses the start date on the same Moscow calendar day');
        assert.equal(url.searchParams.get('date_to'), '26.10.2026');
        body = '<h1>2 вакансии</h1><div data-qa="vacancy-serp__vacancy"><a href="/vacancy/401">Inside exact bound</a></div>' +
          '<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/402">Outside exact bound</a></div>';
      } else {
        const id = url.pathname.split('/').pop();
        if (!['401', '402'].includes(id)) return route.fulfill({ status: 404, body: '' });
        const publishedAt = id === '401' ? new Date(lower.getTime() + 60000).toISOString()
          : new Date(lower.getTime() - 60000).toISOString();
        body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting',
          title: 'Fixture Backend Engineer', datePosted: publishedAt, hiringOrganization: { name: 'Fixture' },
          jobLocation: { address: { addressLocality: 'Москва' } } })}</script>
          <div data-qa="vacancy-description">Backend engineering</div>
          <div data-qa="work-formats-text">Формат работы: В офисе</div>`;
      }
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body>${body}</body></html>` });
    });
    const token = randomBytes(32).toString('hex');
    rpc = createRpcServer({ ownerId: f.owner, token, browser: new HhBrowser({ context, now: () => browserNow }) });
    rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
    const client = new JobBrowserClient({ ownerId: f.owner, token,
      baseUrl: `http://127.0.0.1:${rpc.address().port}`, allowTestHttp: true });
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const history = new JobSearchRepository(f.pool, { accessService });
    const reconcile = new JobSearchRepository(f.pool, { accessService, lane: 'reconcile' });
    const delivery = new JobDeliveryRepository(f.pool, { accessService });
    const initial = await history.ensure({ scope: f.scope });
    await history.saveSettings({ scope: f.scope, expectedRevision: initial.revision,
      settings: { ...initial.settings, queries: ['Fixture'], exclusions: ['Sales'], historyDays: 30, activated: true, paused: false } });
    const result = await new JobCollector({ searchRepository: reconcile, deliveryRepository: delivery,
      hhClient: client, lane: 'reconcile', now: () => browserNow, wait: async () => {} })
      .runOnce({ userId: f.owner, now: collectorNow, force: true });

    assert.equal(result.outcome, 'complete', 'the request survives browser queue and RPC latency near the 30-day boundary');
    let state = await history.getSettings({ userId: f.owner });
    assert.equal(state.reconciliation_checkpoint.toISOString(), collectorNow.toISOString());
    const cards = (await f.pool.query(`SELECT v.external_id,d.priority FROM job_deliveries d
      JOIN job_vacancies v ON v.id=d.vacancy_id WHERE d.kind='card' ORDER BY v.external_id`)).rows;
    assert.deepEqual(cards, [{ external_id: '401', priority: 0 }],
      'the posting one minute after the exact lower bound is included; the one minute before is excluded');
    assert.equal(searchReads, 1);
    assert.equal(writes, 0, 'all HH requests were read-only; no Bot API requests are made');
  } finally {
    if (rpc) await new Promise(resolve => rpc.close(resolve));
    await context?.close(); await browser?.close(); await f.close();
  }
});
