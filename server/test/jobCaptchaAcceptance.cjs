const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const { JobCollector } = require('../src/jobs/jobCollector');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { createRpcServer } = require('../../job-browser/src/rpcServer');

test('PG + real RPC: short waiting checkpoint, deduplicated owner/private attention and delivery', async () => {
  const f = await createJobPostgresFixture();
  let now = new Date('2026-10-15T12:00:00Z'), mode = 'waiting';
  const recoveryId = randomUUID(), credential = 'fixture-private-read-credential-'.repeat(2);
  const rpc = createRpcServer({ ownerId: f.owner, token: credential, browser: { search: async () => {
    throw Object.assign(new Error('untrusted exception text must not escape'), mode === 'waiting'
      ? { code: 'JOB_HH_CAPTCHA_WAITING', retryAfterMs: 120000 } : { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED', recoveryId });
  } } });
  rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
  const search = new JobSearchRepository(f.pool), delivery = new JobDeliveryRepository(f.pool);
  let sends = 0;
  const worker = new JobDeliveryWorker({ pool: f.pool, searchRepository: search, deliveryRepository: delivery, send: async (view) => {
    sends++; assert.equal(view.chatId, '101'); assert.match(view.answer, /капчи HH/); assert.equal(view.disableLinkPreview, true);
    assert.ok(!JSON.stringify(view).includes(credential)); assert.ok(!JSON.stringify(view).includes('untrusted')); assert.deepEqual(view.buttons, []);
    return { message_id: 123 };
  } });
  try {
    let row = await search.ensure({ scope: f.scope });
    row = await search.saveSettings({ scope: f.scope, expectedRevision: row.revision, settings: { ...row.settings, queries: ['Junior AI'], activated: true } });
    const client = new JobBrowserClient({ baseUrl: `http://127.0.0.1:${rpc.address().port}`, allowTestHttp: true, ownerId: f.owner, token: credential });
    const collector = new JobCollector({ searchRepository: search, deliveryRepository: delivery, hhClient: client, now: () => now, wait: async () => {} });
    assert.equal((await collector.runOnce({ userId: f.owner, now, force: true })).outcome, 'JOB_HH_CAPTCHA_WAITING');
    const waiting = await search.getSettings({ userId: f.owner });
    assert.equal(waiting.next_check_at.toISOString(), '2026-10-15T12:02:00.000Z'); assert.equal(waiting.checkpoint, null);
    assert.equal(waiting.progress.windows.length, 1);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 0);
    mode = 'manual'; now = new Date('2026-10-15T12:02:00Z');
    await collector.runOnce({ userId: f.owner, now, force: true });
    await collector.runOnce({ userId: f.owner, now, force: true });
    const attention = (await f.pool.query('SELECT kind,payload,status FROM job_deliveries')).rows;
    assert.deepEqual(attention, [{ kind: 'attention', payload: { reason: 'HH_CAPTCHA' }, status: 'queued' }]);
    assert.deepEqual((await search.getSettings({ userId: f.owner })).progress, waiting.progress);
    assert.equal(await delivery.enqueueAttention({ userId: f.stranger, incidentId: randomUUID() }), null);
    await f.pool.query("UPDATE users SET role='member' WHERE id=$1", [f.owner]);
    await worker.tick(); assert.equal(sends, 0);
    await f.pool.query("UPDATE users SET role='owner' WHERE id=$1", [f.owner]);
    await f.pool.query("UPDATE job_searches SET chat_id='999' WHERE user_id=$1", [f.owner]);
    await worker.tick(); assert.equal(sends, 0);
    await f.pool.query("UPDATE job_searches SET chat_id='101',settings=jsonb_set(settings,'{paused}','true') WHERE user_id=$1", [f.owner]);
    await worker.tick(); await worker.tick(); assert.equal(sends, 1);
    assert.equal((await f.pool.query('SELECT status FROM job_deliveries')).rows[0].status, 'sent');
  } finally { await worker.close(); await new Promise((resolve) => rpc.close(resolve)); await f.close(); }
});
