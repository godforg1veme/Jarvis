const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobUsageRepository } = require('../src/jobs/jobUsageRepository');
const { JobDraftService } = require('../src/jobs/jobDraftService');
const { JobSettingsService } = require('../src/jobs/jobSettingsService');
const { JobTelegramService } = require('../src/jobs/jobTelegramService');
const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
const { UserRepository } = require('../src/users/userRepository');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');
const { once } = require('node:events');
const { createRpcServer } = require('../../job-browser/src/rpcServer');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const { JobBrowserConnectionService } = require('../src/jobs/jobBrowserConnectionService');
const { MENU } = require('../src/telegram/telegramMenu');

test('real message/menu handlers + PG: guided retries, consumption, scopes, draft editing and history privacy', async () => {
  const f = await createJobPostgresFixture(); let updateId = 1000, calls = 0, connectionReads = 0, selectedResume = 'fixtureResume';
  const token = crypto.randomBytes(32).toString('hex');
  const rpc = createRpcServer({ ownerId: f.owner, token, browser: { async connection() {
    connectionReads++; return { resumeId: selectedResume, title: 'Основное fixture резюме' };
  } } });
  rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101'),($2,'telegram','202')", [f.owner, f.stranger]);
    const search = new JobSearchRepository(f.pool), profiles = new JobProfileRepository(f.pool), drafts = new JobDraftRepository(f.pool), usage = new JobUsageRepository(f.pool);
    const interactions = new TelegramInteractionRepository(f.pool);
    const settingsService = new JobSettingsService({ pool: f.pool, searchRepository: search, profileRepository: profiles });
    const draftService = new JobDraftService({ pool: f.pool, searchRepository: search, profileRepository: profiles,
      draftRepository: drafts, usageRepository: usage, defaultModel: 'fixture-model',
      modelAdapter: { async generate() { calls++; return { text: JSON.stringify({ text: `Private fixture letter ${calls}`, factIds: ['fact_1'] }), usage: { cost: 0.001 } }; } } });
    const jobs = new JobTelegramService({ pool: f.pool, searchRepository: search, profileRepository: profiles,
      draftRepository: drafts, usageRepository: usage, draftService, settingsService, interactions, defaultModel: 'fixture-model',
      connectionService: new JobBrowserConnectionService({ pool: f.pool, browserClient: new JobBrowserClient({ ownerId: f.owner,
        token, baseUrl: `http://127.0.0.1:${rpc.address().port}`, allowTestHttp: true }) }) });
    const menu = new TelegramMenuService({ interactions, jobSearchService: jobs });
    const messages = new TelegramMessageService({ accessPolicy: createTelegramAccessPolicy(['101', '202']),
      updateRepository: new TelegramUpdateRepository(f.pool), userRepository: new UserRepository(f.pool),
      conversationRepository: new ConversationRepository(f.pool), menuService: menu,
      assistant: { async answer() { throw new Error('No generic assistant call expected'); } } });
    const msg = (text, from = 101, chat = from, type = 'private') => messages.handle({ update_id: ++updateId,
      message: { message_id: updateId, from: { id: from, first_name: 'Fixture' }, chat: { id: chat, type }, text } });
    const callbackUpdate = (data, from = 101, chat = from, type = 'private') => ({ update_id: ++updateId,
      callback_query: { id: String(updateId), from: { id: from }, data, message: { message_id: updateId, chat: { id: chat, type } } } });
    const cb = (data, ...args) => messages.handleCallback(callbackUpdate(data, ...args));
    const start = await msg('/start');
    assert.equal(start.jobSearchEntry, true);
    assert.equal(start.replyKeyboard.keyboard.at(-1)[0].text, MENU.JOBS);
    const memberStart = await msg('/start', 202);
    assert.equal(memberStart.jobSearchEntry, undefined);
    assert.equal(memberStart.replyKeyboard.keyboard.flat().some((x) => x.text === MENU.JOBS), false);
    const groupStart = await msg('/start', 101, -100, 'group');
    assert.equal(groupStart.replyKeyboard.keyboard.flat().some((x) => x.text === MENU.JOBS), false);
    assert.match((await cb('job:menu', 202)).answer, /владельцу/);
    assert.match((await cb('job:menu', 101, -100, 'group')).answer, /личном/);
    await cb('job:menu');
    assert.match((await msg(MENU.JOBS, 202)).answer, /владельцу/);
    assert.match((await msg(MENU.JOBS, 101, -100, 'group')).answer, /личном/);
    const jobMenu = await msg(MENU.JOBS);
    assert.equal(jobMenu.buttons[0][0].text, 'Включить поиск');
    await cb('job:settings');
    assert.equal((await interactions.getActive(f.scope)).interaction.kind, 'job_settings_edit');
    await msg(MENU.JOBS);
    assert.equal((await interactions.getActive(f.scope)).interaction, null, 'bottom navigation cancels pending settings input');
    const enableUpdate = callbackUpdate('job:resume');
    const enabled = await messages.handleCallback(enableUpdate);
    assert.equal(enabled.buttons[0][0].text, 'Выключить поиск');
    const enabledState = await search.getSettings({ userId: f.owner });
    assert.equal(enabledState.settings.activated, true); assert.equal(enabledState.settings.paused, false);
    assert.equal((await messages.handleCallback(enableUpdate)).status, 'duplicate');
    await cb('job:resume');
    assert.equal((await search.getSettings({ userId: f.owner })).revision, enabledState.revision, 'repeated enable is idempotent');
    const lease = await search.claimSearch({ userId: f.owner, now: new Date(), force: true });
    const progress = { lower: '2026-10-01T12:00:00Z', until: '2026-10-15T12:00:00Z', windows: [{ query: 'AI', page: 1, offset: 3 }] };
    await search.saveProgress({ userId: f.owner, leaseId: lease.lease_id, progress });
    await f.pool.query("UPDATE job_searches SET checkpoint='2026-10-14T12:00:00Z' WHERE user_id=$1", [f.owner]);
    const disabled = await cb('job:pause');
    assert.equal(disabled.buttons[0][0].text, 'Включить поиск');
    const stopped = await search.getSettings({ userId: f.owner });
    assert.equal(stopped.settings.activated, false); assert.equal(stopped.settings.paused, true);
    assert.deepEqual(stopped.progress, progress); assert.equal(stopped.checkpoint.toISOString(), '2026-10-14T12:00:00.000Z');
    assert.deepEqual(stopped.settings.queries, enabledState.settings.queries);
    assert.equal(await search.renewSearch({ userId: f.owner, leaseId: lease.lease_id, revision: lease.revision, now: new Date() }), false);
    assert.equal(await search.finishSearch({ userId: f.owner, leaseId: lease.lease_id,
      checkpoint: new Date(), nextCheckAt: new Date() }), false, 'the stopped collector cannot overwrite the retained progress');
    assert.equal(await search.claimSearch({ userId: f.owner, now: new Date(), force: true }), null);
    await cb('job:pause'); await cb('job:resume', 202); await cb('job:resume', 101, -100, 'group');
    assert.equal((await search.getSettings({ userId: f.owner })).revision, stopped.revision);
    await cb('job:resume');
    assert.deepEqual((await search.getSettings({ userId: f.owner })).progress, progress, 'restart preserves the interrupted window');
    await cb('job:pause');
    await cb('job:connect', 202); await cb('job:connect', 101, -100, 'group');
    assert.equal(connectionReads, 0, 'foreign and group callbacks cannot read the private browser connection');
    assert.match((await cb('job:connect')).answer, /Основное fixture резюме/);
    const connected = (await f.pool.query('SELECT * FROM job_connections WHERE user_id=$1', [f.owner])).rows[0];
    assert.equal(connected.resume_id, 'fixtureResume'); assert.equal(connected.status, 'connected');
    await cb('job:connect');
    assert.equal((await f.pool.query('SELECT revision FROM job_connections WHERE user_id=$1', [f.owner])).rows[0].revision, connected.revision);
    selectedResume = 'replacementResume';
    assert.match((await cb('job:connect')).answer, /Данные изменились/);
    assert.equal((await f.pool.query('SELECT resume_id FROM job_connections WHERE user_id=$1', [f.owner])).rows[0].resume_id, 'fixtureResume');
    selectedResume = 'fixtureResume';
    await cb('job:settings');
    const active = await interactions.getActive(f.scope);
    assert.equal(active.interaction.kind, 'job_settings_edit');
    await msg('интервал = 0');
    assert.equal((await interactions.getActive(f.scope)).interaction.id, active.interaction.id, 'invalid input leaves real PG interaction active');
    let preview = await msg('интервал = 15\nвключить');
    assert.equal((await interactions.getActive(f.scope)).interaction, null);
    assert.equal((await search.getSettings({ userId: f.owner })).settings.activated, false);
    await cb(preview.buttons[0][0].data);
    assert.equal((await search.getSettings({ userId: f.owner })).settings.intervalMs, 900000);
    assert.match((await cb(preview.buttons[0][0].data)).answer, /недоступно/);
    await cb('job:settings');
    const cancelled = await msg('интервал = 20');
    await cb('job:menu');
    assert.match((await cb(cancelled.buttons[0][0].data)).answer, /недоступно/);
    assert.equal((await search.getSettings({ userId: f.owner })).settings.intervalMs, 900000);
    await cb('job:profile');
    await msg('bad profile input');
    assert.equal((await interactions.getActive(f.scope)).interaction.kind, 'job_profile_edit');
    preview = await msg('факт: Private confirmed fixture automation\nпример: Private style example');
    assert.match(preview.answer, /Private confirmed fixture automation/);
    assert.match(preview.answer, /Private style example/, 'approval must show the actual style examples');
    await cb(preview.buttons[0][0].data);
    const vacancy = await search.upsertVacancy({ externalId: '555', snapshot: { title: 'AI Engineer', description: 'LLM', publishedAt: '2026-10-15', url: 'https://hh.ru/vacancy/555' } });
    await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
    assert.match((await cb(`job:prepare:${vacancy.id}`)).answer, /Выбери вариант/);
    await cb('job:base_letter');
    const basePreview = await msg('Owner base fixture letter');
    await cb(basePreview.buttons[0][0].data);
    const update = callbackUpdate(`job:improved:${vacancy.id}`);
    const generated = await messages.handleCallback(update);
    assert.match(generated.answer, /Private fixture letter 1/);
    assert.equal((await messages.handleCallback(update)).status, 'duplicate'); assert.equal(calls, 1);
    const draft = await drafts.current({ userId: f.owner, vacancyId: vacancy.id });
    await cb(`job:edit:${draft.id}`);
    const foreign = await msg('Try editing another owner letter', 202);
    assert.ok(!foreign.answer?.includes('Private fixture letter'));
    const edited = await msg('Shorter, please');
    assert.match(edited.answer, /Private fixture letter 2/);
    assert.equal(calls, 2);
    await cb('job:settings');
    await f.pool.query("UPDATE telegram_interactions SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND status='active'", [f.owner]);
    assert.match((await msg('интервал = 20')).answer, /Время ввода закончилось/);
    const history = (await f.pool.query('SELECT content FROM messages')).rows.map((x) => x.content).join('\n');
    assert.ok(!history.includes('Private fixture letter'));
    assert.ok(!history.includes('Private confirmed fixture automation'));
    console.log('PASS Telegram acceptance: real handlers, real guided state, owner/private scope, retries, expiry and private history');
  } finally { await new Promise((resolve) => rpc.close(resolve)); await f.close(); }
});
