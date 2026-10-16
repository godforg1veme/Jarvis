const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loadJobConfig, isJobManualAccessUrl } = require('../src/jobs/jobConfig');
const { JobTelegramService } = require('../src/jobs/jobTelegramService');
const { JobCollector } = require('../src/jobs/jobCollector');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { telegramReplyMarkup, sendResult } = require('../src/telegram/bot');
const url = 'https://jarvis.fixture-tail.ts.net/hh/';
const owner = randomUUID(), conversation = randomUUID();
const settings = { activated: true, paused: false, intervalMs: 1800000, historyDays: 14, budgetUsd: 3, queries: ['AI'] };
test('manual URL is canonical exact HTTPS ts.net /hh/ and optional', () => {
  assert.equal(loadJobConfig({}).jobManualAccessUrl, '');
  assert.equal(loadJobConfig({ JARVIS_JOB_MANUAL_ACCESS_URL: url }).jobManualAccessUrl, url);
  for (const bad of ['http://jarvis.ts.net/hh/', 'https://ts.net/hh/', 'https://evil.example/hh/', url + '?token=x', url + '#x', url + '?', url + '#',
    'https://u:p@jarvis.ts.net/hh/', 'https://jarvis.ts.net:443/hh/', 'https://Jarvis.ts.net/hh/', 'https://jarvis.ts.net/a/../hh/',
    'https://jarvis.ts.net/hh', 'https://jarvis.ts.net./hh/', 'https://jarvis.ts.net:123/hh/']) {
    assert.equal(isJobManualAccessUrl(bad), false, bad);
    assert.throws(() => loadJobConfig({ JARVIS_JOB_MANUAL_ACCESS_URL: bad }));
  }
});
test('real menu handler checks owner/private and persisted conversation before exposing configured URL', async () => {
  let scopeAllowed = true, ensures = 0;
  const pool = { query: async (sql) => sql.includes('SELECT c.id') ? { rowCount: Number(scopeAllowed) }
    : sql.startsWith('SELECT status') ? { rows: [] } : { rows: [] } };
  const service = new JobTelegramService({ pool, manualAccessUrl: url,
    searchRepository: { ensure: async () => { ensures++; return { settings }; } }, usageRepository: { getMonth: async () => ({ total: 0, month: '2026-10' }) } });
  const context = { user: { role: 'owner', id: owner }, conversation: { id: conversation }, chatType: 'private', chatId: '101', telegramUserId: '101' };
  const view = await service.handleCallback('job:menu', context);
  assert.equal(view.buttons.flat().find(b => b.text === 'Открыть HH').url, url);
  assert.ok(telegramReplyMarkup(view.buttons, { jobManualAccessUrl: url }));
  const sends = []; await sendResult({ reply: async (...args) => sends.push(args) }, { status: 'answered', ...view }, { jobManualAccessUrl: url });
  assert.deepEqual(sends[0][1].link_preview_options, { is_disabled: true });
  for (const change of [{ user: { role: 'member', id: owner } }, { chatType: 'group' }, { chatId: '999' }]) {
    const denied = await service.handleCallback('job:menu', { ...context, ...change }); assert.ok(!JSON.stringify(denied).includes(url));
  }
  scopeAllowed = false; assert.ok(!JSON.stringify(await service.handleCallback('job:menu', context)).includes(url));
  assert.equal(ensures, 1);
  scopeAllowed = true; service.manualAccessUrl = ''; assert.ok(!(await service.handleCallback('job:menu', context)).buttons.flat().some(b => b.url === url));
  assert.throws(() => telegramReplyMarkup([[{ text: 'Открыть HH', url }]]));
  assert.throws(() => telegramReplyMarkup([[{ text: 'Открыть HH', url: 'https://foreign.ts.net/hh/' }]], { jobManualAccessUrl: url }));
  assert.throws(() => telegramReplyMarkup([[{ text: 'Открыть HH', url, data: 'job:menu' }]], { jobManualAccessUrl: url }));
});
test('manual active transport ignores untrusted recovery payload', async () => {
  const client = new JobBrowserClient({ ownerId: owner, token: 'fixture-read-credential-'.repeat(3),
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: 'JOB_HH_MANUAL_ACTIVE', recoveryId: randomUUID(), url: 'https://evil.example', retryAfterMs: 1 }), { status: 409 }) });
  await assert.rejects(client.forUser(owner).search({ query: 'AI' }), e => e.code === 'JOB_HH_MANUAL_ACTIVE' && e.recoveryId === undefined && e.retryAfterMs === undefined);
});
test('collector polls active and configured initial manual after ten seconds with same saved progress and no active notice', async () => {
  for (const [code, access, delay, notices] of [['JOB_HH_MANUAL_ACTIVE', '', 10000, 0], ['JOB_HH_CAPTCHA_MANUAL_REQUIRED', url, 10000, 1], ['JOB_HH_CAPTCHA_MANUAL_REQUIRED', '', 1800000, 1]]) {
    const now = new Date('2026-10-16T12:00:00Z'), recoveryId = randomUUID();
    const progress = { lower: '2026-10-15T12:00:00Z', until: now.toISOString(), windows: [{ query: 'AI', from: now.toISOString(), to: now.toISOString(), page: 34, offset: 16 }] };
    const saved = structuredClone(progress); let finished, attention = [];
    const repo = { claimSearch: async () => ({ settings, progress, checkpoint: '2026-10-15T12:00:00Z', lease_id: randomUUID(), revision: 2 }),
      saveProgress: async () => {}, renewSearch: async () => true, finishSearch: async args => { finished = args; } };
    const collector = new JobCollector({ searchRepository: repo, manualAccessUrl: access,
      deliveryRepository: { enqueueAttention: async a => attention.push(a) }, hhClient: { search: async () => { throw Object.assign(new Error('fixture'), { code, recoveryId }); } }, now: () => now, wait: async () => {} });
    assert.equal((await collector.runOnce({ userId: owner, now })).outcome, code);
    assert.equal(finished.nextCheckAt - now, delay); assert.equal(finished.checkpoint, null);
    assert.deepEqual(progress, saved); assert.equal(attention.length, notices); if (notices) assert.equal(attention[0].incidentId, recoveryId);
  }
});
test('attention ignores payload URL and unknown send is finalized rather than resent', async () => {
  let queued = true, calls = 0, result;
  const worker = new JobDeliveryWorker({ manualAccessUrl: url,
    searchRepository: { getSettings: async () => ({ chat_id: '101' }) },
    deliveryRepository: { claim: async () => queued ? (queued = false, { id: randomUUID(), user_id: owner, kind: 'attention', payload: { reason: 'HH_CAPTCHA', url: 'https://evil.example' } }) : null,
      finish: async a => { result = a; } }, send: async view => { calls++; assert.equal(view.disableLinkPreview, true);
        assert.equal(view.buttons[0][0].url, url); assert.ok(!JSON.stringify(view).includes('evil.example')); throw new Error('unknown acknowledgement'); } });
  await worker.tick(); await worker.tick(); assert.equal(calls, 1); assert.equal(result.outcome, 'unknown');
});
