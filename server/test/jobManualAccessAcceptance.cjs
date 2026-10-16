const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobCollector } = require('../src/jobs/jobCollector');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const { JobTelegramService } = require('../src/jobs/jobTelegramService');
const { telegramReplyMarkup } = require('../src/telegram/bot');
const url = 'https://jarvis.fixture-tail.ts.net/hh/';
test('PG manual handover preserves progress, deduplicates notice and rechecks owner/private menu and delivery', async () => {
  const f = await createJobPostgresFixture(); const recoveryId = randomUUID();
  let now = new Date('2026-10-16T12:00:00Z'), code = 'JOB_HH_CAPTCHA_MANUAL_REQUIRED', calls = 0;
  const search = new JobSearchRepository(f.pool), delivery = new JobDeliveryRepository(f.pool);
  const collector = new JobCollector({ searchRepository: search, deliveryRepository: delivery, manualAccessUrl: url,
    hhClient: { search: async () => { throw Object.assign(new Error('fixture'), { code, recoveryId }); } }, now: () => now, wait: async () => {} });
  const worker = new JobDeliveryWorker({ searchRepository: search, deliveryRepository: delivery, manualAccessUrl: url,
    send: async view => { calls++; assert.equal(view.chatId, '101'); assert.equal(view.buttons[0][0].url, url);
      assert.equal(view.disableLinkPreview, true); assert.ok(telegramReplyMarkup(view.buttons, { jobManualAccessUrl: url })); return { message_id: 123 }; } });
  try {
    let row = await search.ensure({ scope: f.scope });
    row = await search.saveSettings({ scope: f.scope, expectedRevision: row.revision, settings: { ...row.settings, activated: true, queries: ['AI'] } });
    const checkpoint = new Date('2026-10-15T12:00:00Z');
    const progress = { lower: checkpoint.toISOString(), until: now.toISOString(), windows: [{ query: 'AI', from: checkpoint.toISOString(), to: now.toISOString(), page: 34, offset: 16 }] };
    await f.pool.query('UPDATE job_searches SET checkpoint=$1,progress=$2 WHERE user_id=$3', [checkpoint, progress, f.owner]);
    for (const failure of ['JOB_HH_CAPTCHA_MANUAL_REQUIRED', 'JOB_HH_CAPTCHA_MANUAL_REQUIRED', 'JOB_HH_MANUAL_ACTIVE']) {
      code = failure; await collector.runOnce({ userId: f.owner, now, force: true });
      const current = await search.getSettings({ userId: f.owner });
      assert.equal(current.next_check_at - now, 10000); assert.equal(current.checkpoint.toISOString(), checkpoint.toISOString());
      assert.deepEqual(current.progress, progress); assert.deepEqual(current.settings, row.settings); assert.equal(current.lease_id, null);
      now = new Date(now.getTime() + 10000);
    }
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 1);
    const service = new JobTelegramService({ pool: f.pool, searchRepository: search, manualAccessUrl: url, usageRepository: { getMonth: async () => ({ total: 0, month: '2026-10' }) } });
    const context = { user: { id: f.owner, role: 'owner' }, conversation: { id: f.scope.conversationId }, chatId: '101', telegramUserId: '101', chatType: 'private' };
    assert.equal((await service.handleCallback('job:menu', context)).buttons.flat().find(b => b.text === 'Открыть HH').url, url);
    for (const change of [{ user: { id: f.stranger, role: 'owner' } }, { conversation: { id: randomUUID() } }, { chatId: '999', telegramUserId: '999' }, { chatType: 'group' }, { user: { id: f.owner, role: 'member' } }]) {
      assert.ok(!JSON.stringify(await service.handleCallback('job:menu', { ...context, ...change })).includes(url));
    }
    service.manualAccessUrl = ''; assert.ok(!JSON.stringify(await service.handleCallback('job:menu', context)).includes(url));
    await f.pool.query("UPDATE users SET role='member' WHERE id=$1", [f.owner]); await worker.tick(); assert.equal(calls, 0);
    await f.pool.query("UPDATE users SET role='owner' WHERE id=$1", [f.owner]);
    await f.pool.query("UPDATE job_searches SET chat_id='999' WHERE user_id=$1", [f.owner]); await worker.tick(); assert.equal(calls, 0);
    await f.pool.query("UPDATE job_searches SET chat_id='101' WHERE user_id=$1", [f.owner]); await worker.tick(); await worker.tick(); assert.equal(calls, 1);
    await search.setEnabled({ scope: f.scope, expectedRevision: row.revision, enabled: false });
    assert.equal((await collector.runOnce({ userId: f.owner, now, force: true })).outcome, 'not_due');
    assert.equal((await search.getSettings({ userId: f.owner })).settings.paused, true);
  } finally { await worker.close(); await f.close(); }
});
