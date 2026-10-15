// Explicit Linux integration: real PG + RPC + Chromium + durable private journal.
// HH-shaped pages are fulfilled in memory; no live HH account is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { chromium } = require('../../job-browser/node_modules/playwright');
const { HhBrowser } = require('../../job-browser/src/hhBrowser');
const { HhApplicationDriver } = require('../../job-browser/src/hhApplicationDriver');
const { ApplicationLedger } = require('../../job-browser/src/applicationLedger');
const { GuardedSubmission } = require('../../job-browser/src/guardedSubmission');
const { createRpcServer } = require('../../job-browser/src/rpcServer');
const { installApplicationFixture } = require('../../job-browser/test/helpers/hhApplicationFixture');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { createJobRuntime } = require('../src/jobs/jobRuntime');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');

test('confirmed Telegram path → PG intent → write RPC → native Chromium UI; restart reconciles exact letter without another POST', async () => {
  const f = await createJobPostgresFixture();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-pg-driver-')); await fs.chmod(root, 0o700);
  const resumeId = 'fixtureResume', letter = 'Подтверждённый опыт автоматизации.\nAI & бизнес-процессы.';
  const token = randomBytes(32).toString('hex'), applyToken = randomBytes(32).toString('hex');
  let browser, context, rpc, runtime;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    const fixture = await installApplicationFixture(context, { resumeId, async onPost() {
      const rows = (await f.pool.query("SELECT * FROM job_applications WHERE status='sending'")).rows;
      assert.equal(rows.length, 1, 'the durable PG intent precedes the only POST');
      assert.equal(rows[0].approved_text, letter);
      assert.ok((await fs.readdir(root)).some((name) => name.startsWith('operation-')));
      assert.ok((await fs.readdir(root)).some((name) => name.startsWith('pair-')));
    } });
    const hh = new HhBrowser({ context, primaryResumeId: resumeId });
    const driver = new HhApplicationDriver({ browser: hh, dispatch: (route) => route.fallback(), responseTimeoutMs: 500 });
    const coordinator = () => new GuardedSubmission({ ownerId: f.owner, primaryResumeId: resumeId,
      driver, ledger: new ApplicationLedger({ root, ownerId: f.owner }) });
    let guarded = coordinator();
    rpc = createRpcServer({ ownerId: f.owner, token, applyToken, browser: hh, submissions: {
      submit: (input) => hh.run(() => guarded.submit(input)), reconcile: (input) => hh.run(() => guarded.reconcile(input)),
    } });
    rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
    const config = { jobSearchEnabled: true, jobBrowserUrl: 'http://job-browser:8080', jobBrowserOwnerId: f.owner,
      jobBrowserToken: token, jobBrowserApplyToken: applyToken, jobBrowserApplyEnabled: true };
    const create = () => createJobRuntime({ config, pool: f.pool, send: async () => {}, fetchImpl: (url, options) => {
      assert.equal(url, 'http://job-browser:8080/rpc');
      return fetch(`http://127.0.0.1:${rpc.address().port}/rpc`, options);
    } });
    runtime = create();
    const jobs = () => runtime.telegramService;
    const ctx = { user: { id: f.owner, role: 'owner' }, conversation: { id: f.scope.conversationId },
      chatType: 'private', chatId: '101', telegramUserId: '101' };
    const cb = (data, override = {}) => jobs().handleCallback(data, { ...ctx, ...override });
    assert.match((await cb('job:connect')).answer, /Основное резюме/);
    const search = new JobSearchRepository(f.pool), profiles = new JobProfileRepository(f.pool), drafts = new JobDraftRepository(f.pool);
    await profiles.replace({ scope: f.scope, expectedRevision: 0, profile: { confirmed: true,
      facts: [{ id: 'automation', text: 'Подтверждённый опыт автоматизации.', confirmed: true }], examples: [] } });
    const prepare = async (externalId) => {
      const snapshot = await hh.getVacancy({ externalId });
      const vacancy = await search.upsertVacancy({ externalId, snapshot });
      await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
      const draft = await drafts.append({ scope: f.scope, vacancyId: vacancy.id, profileRevision: 1,
        vacancyRevision: vacancy.revision, text: letter, facts: ['automation'] });
      const reply = await cb(`job:send:${draft.id}`);
      assert.ok(reply.answer.includes(letter));
      assert.equal(reply.buttons?.[0]?.[0]?.text, 'Подтвердить отправку');
      return reply.buttons[0][0].data;
    };
    const first = await prepare('123'); assert.equal(fixture.posts, 0);
    assert.match((await cb(first, { chatId: '-100', chatType: 'group' })).answer, /личном/);
    assert.equal(fixture.posts, 0);
    const sent = await cb(first); assert.equal(sent.applicationStatus, 'sent'); assert.equal(fixture.posts, 1);
    assert.equal((await cb(first)).operationId, sent.operationId); assert.equal(fixture.posts, 1);
    fixture.loseAcknowledgement = true;
    const second = await prepare('124');
    const uncertain = await cb(second); assert.equal(uncertain.applicationStatus, 'unknown'); assert.equal(fixture.posts, 2);
    const original = await runtime.applicationRepository.get({ scope: f.scope, operationId: uncertain.operationId });
    assert.equal(original.approved_text, letter); assert.equal(original.status, 'unknown');
    await runtime.close(); guarded = coordinator(); runtime = create();
    assert.equal((await cb(second)).applicationStatus, 'unknown'); assert.equal(fixture.posts, 2);
    fixture.wrongRecoveredLetter = false;
    const recovered = await cb(second);
    assert.equal(recovered.applicationStatus, 'sent'); assert.equal(recovered.operationId, uncertain.operationId);
    assert.equal(fixture.posts, 2); assert.ok(fixture.chatRequests >= 2);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_applications')).rows[0].n, 2);
  } finally {
    await runtime?.close(); if (rpc) await new Promise((resolve) => rpc.close(resolve));
    await context?.close(); await browser?.close(); await f.close();
    // Only the unique fixture journal under the OS temp directory is removed.
    await fs.rm(root, { recursive: true, force: true });
  }
});
