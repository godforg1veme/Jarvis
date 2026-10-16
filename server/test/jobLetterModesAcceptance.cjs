const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobProfileRepository } = require('../src/jobs/jobProfileRepository');
const { JobDraftRepository } = require('../src/jobs/jobDraftRepository');
const { JobUsageRepository } = require('../src/jobs/jobUsageRepository');
const { JobDraftService } = require('../src/jobs/jobDraftService');
const { JobSettingsService } = require('../src/jobs/jobSettingsService');
const { JobTelegramService } = require('../src/jobs/jobTelegramService');
const { JobApplicationRepository } = require('../src/jobs/jobApplicationRepository');
const { JobApplicationService } = require('../src/jobs/jobApplicationService');
const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
const { UserRepository } = require('../src/users/userRepository');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');

async function harness() {
  const f = await createJobPostgresFixture();
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101'),($2,'telegram','202')", [f.owner, f.stranger]);
  await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'fixture-resume','connected')", [f.owner]);
  const search = new JobSearchRepository(f.pool), profiles = new JobProfileRepository(f.pool);
  const drafts = new JobDraftRepository(f.pool), usage = new JobUsageRepository(f.pool);
  const interactions = new TelegramInteractionRepository(f.pool), prompts = [], submissions = [], snapshots = new Map();
  let updateId = 100, vacancyNumber = 100, failModel = false, unknown = false;
  const draftService = new JobDraftService({ pool: f.pool, searchRepository: search, profileRepository: profiles,
    draftRepository: drafts, usageRepository: usage, modelAdapter: { async generate({ messages }) {
      prompts.push(messages);
      if (failModel) throw Object.assign(new Error('Fixture failure'), { code: 'JOB_MODEL_UNAVAILABLE' });
      const data = JSON.parse(messages[1].content);
      return { text: JSON.stringify({ text: `Adapted ${prompts.length}: ${data.sourceLetter}`,
        factIds: data.facts.map((x) => x.id) }), usage: { cost: 0.001 } };
    } } });
  const applications = new JobApplicationRepository(f.pool);
  const applicationService = new JobApplicationService({ pool: f.pool, repository: applications, searchRepository: search,
    adapter: { capabilities: { applicantApply: true },
      async inspect({ externalId }) { return { resumeAvailable: true, vacancy: snapshots.get(externalId) }; },
      async submit(input) { submissions.push(input); return unknown ? { outcome: 'unknown' }
        : { outcome: 'sent', verified: true, externalId: `fixture-${submissions.length}` }; },
      async reconcile() { return { outcome: 'unknown' }; } } });
  const settingsService = new JobSettingsService({ pool: f.pool, searchRepository: search, profileRepository: profiles });
  const jobs = new JobTelegramService({ pool: f.pool, searchRepository: search, profileRepository: profiles,
    draftRepository: drafts, usageRepository: usage, interactions, draftService, settingsService, applicationService });
  const messages = new TelegramMessageService({ accessPolicy: createTelegramAccessPolicy(['101', '202']),
    updateRepository: new TelegramUpdateRepository(f.pool), userRepository: new UserRepository(f.pool),
    conversationRepository: new ConversationRepository(f.pool),
    menuService: new TelegramMenuService({ interactions, jobSearchService: jobs }),
    assistant: { async answer() { return 'Fixture dialogue'; } } });
  const messageUpdate = (text, from = 101, chat = from, type = 'private') => ({ update_id: ++updateId,
    message: { message_id: updateId, from: { id: from, first_name: 'Fixture' }, chat: { id: chat, type }, text } });
  const callbackUpdate = (data, from = 101, chat = from, type = 'private') => ({ update_id: ++updateId,
    callback_query: { id: String(updateId), from: { id: from }, data,
      message: { message_id: updateId, chat: { id: chat, type } } } });
  const msg = (...args) => messages.handle(messageUpdate(...args));
  const cb = (...args) => messages.handleCallback(callbackUpdate(...args));
  const base = async (text) => {
    await cb('job:base_letter'); const preview = await msg(text);
    assert.ok(preview.answer.includes(text));
    await cb(preview.buttons[0][0].data);
  };
  const vacancy = async () => {
    const externalId = String(++vacancyNumber);
    const snapshot = { externalId, title: 'Fixture AI role', company: 'Fixture company',
      description: 'Build useful tools', url: `https://hh.ru/vacancy/${externalId}`, publishedAt: '2026-10-16T10:00:00Z', archived: false };
    snapshots.set(externalId, snapshot);
    const row = await search.upsertVacancy({ externalId, snapshot });
    await search.recordMatch({ userId: f.owner, vacancyId: row.id, filterRevision: 1 });
    return row;
  };
  const model = async () => {
    const s = await search.ensure({ scope: f.scope });
    await search.saveSettings({ scope: f.scope, expectedRevision: s.revision, settings: { ...s.settings, model: 'fixture-model' } });
  };
  const current = (v) => drafts.current({ userId: f.owner, vacancyId: v.id });
  const send = async (v) => {
    const d = await current(v), preview = await cb(`job:send:${d.id}`);
    assert.ok(preview.answer.includes(d.text));
    const data = preview.buttons[0][0].data;
    return { data, result: await cb(data) };
  };
  await cb('job:menu');
  return { ...f, search, profiles, drafts, interactions, prompts, submissions, messages, jobs, draftService, applications,
    cb, msg, base, vacancy, model, current, send, messageUpdate, callbackUpdate,
    failModel: () => { failModel = true; }, unknown: () => { unknown = true; } };
}

test('four real Telegram paths: optional profile, exact manual letters, source-aware AI and explicit HH confirmations', async () => {
  const f = await harness();
  try {
    const first = await f.vacancy();
    assert.match((await f.cb(`job:base:${first.id}`)).answer, /ещё не задано/);
    assert.match((await f.cb(`job:improved:${first.id}`)).answer, /ещё не задано/);
    assert.equal(f.prompts.length, 0);
    await f.cb(`job:custom:${first.id}`);
    const text = 'Private custom exact text\n\nSecond paragraph <b>literal</b>.';
    await f.msg(text);
    assert.equal((await f.current(first)).text, text);
    assert.equal((await f.current(first)).letter_mode, 'custom');
    assert.equal((await f.send(first)).result.applicationStatus, 'sent');
    assert.equal(f.submissions[0].letter, text);
    await f.base('Private base exact text\n\nOwner experience from letter.');
    const profile = await f.profiles.get({ userId: f.owner });
    assert.equal(profile.profile.confirmed, false, 'no need to confirm an empty facts profile');
    assert.deepEqual(profile.profile.facts, []);
    const second = await f.vacancy();
    await f.cb(`job:base:${second.id}`);
    assert.equal((await f.current(second)).text, profile.profile.baseLetter);
    assert.equal(f.prompts.length, 0, 'both manual modes work with no configured model');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_tasks')).rows[0].n, 0);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_usage')).rows[0].n, 0);
    const sent = await f.send(second);
    assert.equal(sent.result.applicationStatus, 'sent');
    const beforeReplay = f.submissions.length;
    await f.cb(sent.data);
    assert.equal(f.submissions.length, beforeReplay);
    const third = await f.vacancy();
    assert.match((await f.cb(`job:improved:${third.id}`)).answer, /выбрать модель/);
    await f.model();
    const update = f.callbackUpdate(`job:improved:${third.id}`);
    await f.messages.handleCallback(update);
    assert.equal((await f.messages.handleCallback(update)).status, 'duplicate');
    assert.equal(f.prompts.length, 1);
    assert.equal(JSON.parse(f.prompts[0][1].content).sourceLetter, profile.profile.baseLetter);
    assert.equal((await f.current(third)).letter_mode, 'improved');
    assert.equal((await f.send(third)).result.applicationStatus, 'sent');
    const fourth = await f.vacancy();
    await f.cb(`job:custom_ai:${fourth.id}`);
    await f.msg('Private custom AI source');
    assert.equal(f.prompts.length, 2);
    assert.equal(JSON.parse(f.prompts[1][1].content).sourceLetter, 'Private custom AI source');
    assert.equal((await f.current(fourth)).letter_mode, 'custom_ai');
    assert.equal((await f.profiles.get({ userId: f.owner })).profile.baseLetter, profile.profile.baseLetter);
    assert.equal((await f.send(fourth)).result.applicationStatus, 'sent');
    assert.equal(f.submissions.length, 4);
    const history = (await f.pool.query('SELECT content FROM messages')).rows.map((x) => x.content).join('\n');
    assert.doesNotMatch(history, /Private custom|Private base|Owner experience|Adapted/);
  } finally { await f.close(); }
});

test('both AI modes use facts/examples; edits preserve source and a model failure keeps the draft', async () => {
  const f = await harness();
  try {
    await f.model();
    await f.cb('job:profile');
    const preview = await f.msg('факт: Private actual owner project\nпример: Private concise style');
    await f.cb(preview.buttons[0][0].data);
    await f.base('Private source experience');
    const v = await f.vacancy();
    await f.cb(`job:improved:${v.id}`);
    let d = await f.current(v);
    await f.cb(`job:regenerate:${d.id}`);
    await f.cb(`job:custom_ai:${v.id}`);
    await f.msg('Private custom AI experience');
    d = await f.current(v);
    await f.cb(`job:edit:${d.id}`); await f.msg('Make it shorter');
    d = await f.current(v);
    await f.cb(`job:translate:${d.id}`); await f.msg('английский');
    for (const [index, prompt] of f.prompts.entries()) {
      const data = JSON.parse(prompt[1].content);
      assert.equal(data.sourceLetter, index < 2 ? 'Private source experience' : 'Private custom AI experience');
      if (index === 0 || index === 2) assert.equal(data.previousText, '', 'new mode selection must not import a previous unrelated letter');
      assert.equal(data.facts[0].text, 'Private actual owner project');
      assert.deepEqual(data.approvedStyleExamples, ['Private concise style']);
      assert.equal(data.vacancy.title, v.snapshot.title);
      assert.ok(!prompt[0].content.includes('Private'));
    }
    d = await f.current(v); f.failModel();
    assert.match((await f.cb(`job:regenerate:${d.id}`)).answer, /недоступна/);
    assert.equal((await f.current(v)).id, d.id);
    const before = f.submissions.length;
    const prepared = await f.cb(`job:send:${d.id}`);
    await f.base('Private replacement base');
    assert.notEqual((await f.cb(prepared.buttons[0][0].data)).applicationStatus, 'sent');
    assert.equal(f.submissions.length, before);
    assert.equal((await f.profiles.get({ userId: f.owner })).profile.facts[0].text, 'Private actual owner project');
  } finally { await f.close(); }
});

test('guided inputs: real allowlist, invalid retry, atomic consumption, expiry, stale revision and foreign scopes', async () => {
  const f = await harness();
  try {
    for (const kind of ['job_base_letter_edit', 'job_custom_letter', 'job_custom_letter_ai']) {
      await assert.rejects(f.interactions.begin({ ...f.scope, kind, context: { targetId: f.owner, revision: 1, extra: true } }));
    }
    const v = await f.vacancy();
    for (const action of ['base_letter', `custom:${v.id}`, `custom_ai:${v.id}`]) {
      assert.match((await f.cb(`job:${action}`, 202)).answer, /владельцу/);
      assert.match((await f.cb(`job:${action}`, 101, -100, 'group')).answer, /личном/);
      assert.match((await f.cb(`job:${action}`, 101, 999)).answer, /личном/);
      await f.cb(`job:${action}`);
      const active = (await f.interactions.getActive(f.scope)).interaction;
      assert.ok(active);
      await assert.rejects(f.msg('x'.repeat(10001)), /message text is too long/);
      assert.equal((await f.interactions.getActive(f.scope)).interaction.id, active.id);
      await f.msg('password=private-fixture-value');
      assert.equal((await f.interactions.getActive(f.scope)).interaction.id, active.id);
      const foreign = await f.msg('Private foreign input', 202);
      assert.ok(!foreign.answer.includes('Private'));
      assert.equal((await f.interactions.getActive(f.scope)).interaction.id, active.id);
      await f.pool.query("UPDATE telegram_interactions SET expires_at=now()-interval '1 minute' WHERE id=$1", [active.id]);
      assert.match((await f.msg('Private expired input')).answer, /Время ввода закончилось/);
    }
    await f.cb(`job:custom:${v.id}`);
    const old = (await f.interactions.getActive(f.scope)).interaction;
    await f.pool.query('UPDATE job_vacancies SET revision=revision+1 WHERE id=$1', [v.id]);
    assert.match((await f.msg('Private stale input')).answer, /Данные изменились/);
    assert.equal(await f.current(v), null);
    await f.cb(`job:custom:${v.id}`);
    const update = f.messageUpdate('Private once-only letter');
    await f.messages.handle(update);
    assert.equal((await f.messages.handle(update)).status, 'duplicate');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_drafts')).rows[0].n, 1);
    assert.equal(await f.interactions.consume({ ...f.scope, id: old.id }), null);
    await f.cb('job:base_letter');
    const basePreview = await f.msg('Private pending base');
    const profile = await f.profiles.get({ userId: f.owner });
    await f.profiles.replace({ scope: f.scope, expectedRevision: profile.revision, profile: profile.profile });
    assert.match((await f.cb(basePreview.buttons[0][0].data)).answer, /Данные изменились/);
    assert.equal((await f.profiles.get({ userId: f.owner })).profile.baseLetter, '');
  } finally { await f.close(); }
});

test('unknown manual send retains original operation; changing modes invalidates pending confirmation', async () => {
  const f = await harness();
  try {
    const v = await f.vacancy();
    await f.cb(`job:custom:${v.id}`); await f.msg('Private manual original');
    let d = await f.current(v);
    const prepared = await f.cb(`job:send:${d.id}`);
    await f.cb(`job:prepare:${v.id}`);
    assert.notEqual((await f.cb(prepared.buttons[0][0].data)).applicationStatus, 'sent');
    assert.equal(f.submissions.length, 0);
    f.unknown();
    const sent = await f.send(v);
    assert.equal(sent.result.applicationStatus, 'unknown');
    const again = await f.cb(sent.data);
    assert.equal(again.applicationStatus, 'unknown');
    assert.equal(again.operationId, sent.result.operationId);
    assert.equal(f.submissions.length, 1);
    const foreignConversation = (await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','303') RETURNING id", [f.owner])).rows[0].id;
    await assert.rejects(f.jobs.applicationService.confirm({ scope: { ...f.scope, conversationId: foreignConversation, chatId: '303' },
      confirmationId: sent.data.split(':').at(-1) }));
    assert.equal(f.prompts.length, 0);
    d = await f.current(v);
    assert.equal(d.source_text, 'Private manual original');
  } finally { await f.close(); }
});
