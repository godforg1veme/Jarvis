const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { HhClient } = require('../src/jobs/hhClient');
const { JobCollector } = require('../src/jobs/jobCollector');
const { randomBytes } = require('node:crypto');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { createRpcServer } = require('../../job-browser/src/rpcServer');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');

async function collectorFixture() {
  const fixture = await createJobPostgresFixture();
  try {
    await fixture.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [fixture.owner]);
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}

function repositories(f) {
  const accessService = configuredOwnerJobAccess(f.pool, '101');
  return { search: new JobSearchRepository(f.pool, { accessService }),
    delivery: new JobDeliveryRepository(f.pool, { accessService }) };
}

test('empty search cannot activate or be claimed, including an already-active legacy row', async () => {
  const f = await collectorFixture();
  try {
    const { search } = repositories(f);
    const initial = await search.ensure({ scope: f.scope });
    assert.deepEqual(initial.settings.queries, []);
    await assert.rejects(search.setEnabled({ scope: f.scope, expectedRevision: initial.revision, enabled: true }),
      { code: 'JOB_SEARCH_QUERIES_REQUIRED' });
    const saved = await search.saveSettings({ scope: f.scope, expectedRevision: initial.revision,
      settings: { ...initial.settings, activated: true, paused: false } });
    assert.equal(saved.settings.activated, false);
    assert.equal(saved.settings.paused, true);
    await f.pool.query("UPDATE job_searches SET settings=jsonb_set(jsonb_set(settings,'{activated}','true'::jsonb),'{paused}','false'::jsonb),next_check_at=now()-interval '1 minute' WHERE user_id=$1", [f.owner]);
    assert.deepEqual(await search.dueUsers(), []);
    assert.equal(await search.claimSearch({ userId: f.owner, now: new Date(), force: true }), null);
    assert.equal((await f.pool.query('SELECT lease_id FROM job_searches WHERE user_id=$1', [f.owner])).rows[0].lease_id, null);
  } finally { await f.close(); }
});

test('real HTTP + PostgreSQL: 14 days, pagination, duplicate queries, restart, failure checkpoint and pause', async () => {
  const f = await collectorFixture();
  const requests = []; let failSecondPage = false;
  const now = new Date('2026-10-15T12:00:00Z');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); requests.push(url);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/vacancies') {
      if (failSecondPage && url.searchParams.get('page') === '1') { res.statusCode = 503; return res.end('{}'); }
      return res.end(JSON.stringify({ found: 2, pages: 2,
        items: [{ id: url.searchParams.get('page') === '1' ? '202' : '101' }] }));
    }
    const id = url.pathname.split('/').pop();
    res.end(JSON.stringify({ id, name: id === '101' ? 'Junior AI Engineer' : 'Менеджер по продажам AI',
      published_at: '2026-10-14T10:00:00Z', description: id === '101' ? 'LLM integration' : 'Холодные звонки',
      work_format: [{ id: 'ON_SITE' }], area: { name: 'Москва' }, employer: { name: 'Fixture' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const { search, delivery } = repositories(f);
    let state = await search.ensure({ scope: f.scope });
    state = await search.saveSettings({ scope: f.scope, expectedRevision: state.revision,
      settings: { ...state.settings, queries: ['Junior AI', 'AI Engineer'], exclusions: ['Холодные звонки'], activated: true } });
    // Scheduling uses the database clock; bind it to this fixture's fixed clock.
    await f.pool.query('UPDATE job_searches SET next_check_at=$1 WHERE user_id=$2', [now, f.owner]);
    const hh = new HhClient({ baseUrl: `http://127.0.0.1:${server.address().port}/`, allowTestHttp: true });
    const collector = () => new JobCollector({ searchRepository: search, deliveryRepository: delivery,
      hhClient: hh, now: () => now, wait: async () => {} });
    const result = await collector().runOnce({ userId: f.owner, now });
    assert.equal(result.outcome, 'complete'); assert.equal(result.matched, 1);
    assert.equal(requests[0].searchParams.get('date_from'), '2026-10-01T12:00:00.000Z');
    assert.ok(requests.some((url) => url.searchParams.get('page') === '1'));
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 1);
    await collector().runOnce({ userId: f.owner, now, force: true });
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 1);
    const checkpoint = (await search.getSettings({ userId: f.owner })).checkpoint;
    failSecondPage = true;
    const failed = await collector().runOnce({ userId: f.owner, now: new Date(now.getTime() + 3600000), force: true });
    assert.equal(failed.outcome, 'JOB_HH_UNAVAILABLE');
    assert.equal((await search.getSettings({ userId: f.owner })).checkpoint.toISOString(), checkpoint.toISOString());
    assert.ok((await search.getSettings({ userId: f.owner })).progress, 'failed collection retains exact window progress');
    failSecondPage = false;
    const resumed = await collector().runOnce({ userId: f.owner, now, force: true });
    assert.equal(resumed.outcome, 'complete');
    assert.equal((await search.getSettings({ userId: f.owner })).progress, null);
    state = await search.getSettings({ userId: f.owner });
    await search.saveSettings({ scope: f.scope, expectedRevision: state.revision, settings: { ...state.settings, paused: true } });
    assert.equal((await collector().runOnce({ userId: f.owner, now, force: true })).outcome, 'not_due');
    console.log('PASS collection acceptance: actual local HTTP, actual PostgreSQL, no model or Telegram network');
  } finally { await new Promise((resolve) => server.close(resolve)); await f.close(); }
});

test('bounded passes resume at the unfinished card rather than restarting an oversized window', async () => {
  const f = await collectorFixture();
  try {
    const { search, delivery } = repositories(f);
    const settings = await search.ensure({ scope: f.scope });
    await search.saveSettings({ scope: f.scope, expectedRevision: 1,
      settings: { ...settings.settings, queries: ['AI Engineer'], activated: true } });
    const now = new Date('2026-10-15T12:00:00Z');
    const hh = { async search() { return { items: [{ id: '1' }, { id: '2' }, { id: '3' }], found: 3, pages: 1 }; },
      async getVacancy({ externalId }) { return { externalId, title: 'AI Engineer', publishedAt: '2026-10-14T10:00:00Z',
        description: 'AI integration', city: 'Москва', workFormat: 'office' }; } };
    const run = () => new JobCollector({ searchRepository: search, deliveryRepository: delivery, hhClient: hh,
      now: () => now, wait: async () => {}, maxRequests: 2 }).runOnce({ userId: f.owner, now, force: true });
    assert.equal((await run()).outcome, 'JOB_COLLECTION_LIMIT');
    assert.equal((await search.getSettings({ userId: f.owner })).progress.windows[0].offset, 1);
    assert.equal((await run()).outcome, 'JOB_COLLECTION_LIMIT');
    assert.equal((await run()).outcome, 'complete');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 3);
  } finally { await f.close(); }
});

test('browser RPC + PostgreSQL: broad searches split at Moscow days and resume after CAPTCHA', async () => {
  const f = await collectorFixture();
  const token = randomBytes(32).toString('hex'), now = new Date('2026-10-15T12:00:00Z');
  const requests = []; let captcha = true;
  const rpc = createRpcServer({ ownerId: f.owner, token, browser: {
    async search(args) {
      requests.push(args);
      const firstDay = Math.floor((Date.parse(args.publishedFrom) + 10800000) / 86400000);
      const lastDay = Math.floor((Date.parse(args.publishedTo) + 10800000) / 86400000);
      if (firstDay !== lastDay) return { found: 2001, pages: 101, items: [{ id: '123' }] };
      if (captcha) throw Object.assign(new Error('challenge'), { code: 'JOB_HH_CAPTCHA_REQUIRED' });
      return { found: 1, pages: 1, items: [{ id: '123' }] };
    },
    async getVacancy({ externalId }) { return { externalId, title: 'Junior AI Engineer', company: 'Fixture',
      description: 'AI integration', city: 'Москва', workFormat: 'office', publishedAt: '2026-10-14T10:00:00Z' }; },
  } });
  rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
  try {
    const { search, delivery } = repositories(f);
    const initial = await search.ensure({ scope: f.scope });
    await search.saveSettings({ scope: f.scope, expectedRevision: initial.revision,
      settings: { ...initial.settings, queries: ['AI Engineer'], activated: true } });
    const hh = new JobBrowserClient({ ownerId: f.owner, token, baseUrl: `http://127.0.0.1:${rpc.address().port}`, allowTestHttp: true });
    const run = () => new JobCollector({ searchRepository: search, deliveryRepository: delivery,
      hhClient: hh, now: () => now, wait: async () => {}, maxRequests: 500 }).runOnce({ userId: f.owner, now, force: true });
    assert.equal((await run()).outcome, 'JOB_HH_CAPTCHA_REQUIRED');
    let state = await search.getSettings({ userId: f.owner });
    assert.equal(state.checkpoint, null); assert.ok(state.progress.windows.length > 1);
    captcha = false;
    assert.equal((await run()).outcome, 'complete');
    state = await search.getSettings({ userId: f.owner });
    assert.equal(state.checkpoint.toISOString(), now.toISOString()); assert.equal(state.progress, null);
    assert.ok(requests.every((request) => request.page === 0), 'broad page is split before details or pagination');
    assert.ok(new Set(requests.map((request) => request.publishedFrom)).size > 1);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 1);
  } finally { await new Promise((resolve) => rpc.close(resolve)); await f.close(); }
});
