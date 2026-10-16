const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { createJobRuntime } = require('../src/jobs/jobRuntime');
const { createCollectorRuntime } = require('../src/jobs/collectorMain');
const { HhClient } = require('../src/jobs/hhClient');
const { createTelegramBot, telegramReplyMarkup } = require('../src/telegram/bot');
const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
const { TelegramMessageService } = require('../src/telegram/messageService');
const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
const { UserRepository } = require('../src/users/userRepository');
const { ConversationRepository } = require('../src/conversations/conversationRepository');
const { createTelegramAccessPolicy } = require('../src/telegram/accessPolicy');

test('E2E local HTTP + actual bot + PG: configure, collect, letter, approval, lost acknowledgement and original-ID reconciliation', async () => {
  const fixture = await createJobPostgresFixture();
  let updateId = 4000, modelCalls = 0, telegramId = 0;
  const sent = [], upstreamCalls = [];
  const publicationTime = new Date(Date.now() - 60000).toISOString();
  const applications = new Map(); let submitCalls = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); upstreamCalls.push(url.pathname);
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json');
    const json = (value) => res.end(JSON.stringify(value));
    if (url.pathname === '/model') {
      modelCalls++;
      return json({ id: `fixture-generation-${modelCalls}`, usage: { cost: 0.002 }, choices: [{ message: {
        content: JSON.stringify({ text: `Fixture cover letter ${modelCalls}`, factIds: ['fact_1'] }) } }] });
    }
    if (url.pathname === '/hh/vacancies') return json({ found: 1, pages: 1, items: [{ id: '9001' }] });
    if (url.pathname === '/hh/vacancies/9001') return json({ id: '9001', name: 'Junior AI Engineer',
      employer: { name: 'Fixture company' }, description: 'Build AI tools and API integrations',
      work_format: [{ id: 'REMOTE' }], published_at: publicationTime });
    if (url.pathname === '/connector/inspect') return json({ resumeAvailable: true });
    if (url.pathname === '/connector/submit') {
      submitCalls++; const input = JSON.parse(body);
      applications.set(input.operationId, { outcome: 'sent', verified: true, externalId: 'fixture-application' });
      // Simulate a committed external mutation whose acknowledgement never reaches Jarvis.
      return res.destroy();
    }
    if (url.pathname === '/connector/reconcile') return json(applications.get(url.searchParams.get('operationId')) || { outcome: 'unknown' });
    if (url.pathname === '/telegram/getMe') return json({ ok: true, result: { id: 5000, is_bot: true, first_name: 'Fixture bot', username: 'fixture_jobs_bot' } });
    if (url.pathname === '/telegram/answerCallbackQuery') return json({ ok: true, result: true });
    if (url.pathname === '/telegram/sendMessage') {
      const payload = JSON.parse(body); sent.push(payload);
      return json({ ok: true, result: { message_id: ++telegramId, date: Math.floor(Date.now() / 1000),
        chat: { id: Number(payload.chat_id), type: 'private' }, text: payload.text } });
    }
    res.statusCode = 404; json({ ok: false });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let collector, jobs, bot;
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await fixture.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [fixture.owner]);
    const interactions = new TelegramInteractionRepository(fixture.pool);
    const hh = new HhClient({ baseUrl: `${origin}/hh/`, allowTestHttp: true });
    const applicationAdapter = { capabilities: { applicantApply: true },
      async inspect({ externalId }) {
        const data = await (await fetch(`${origin}/connector/inspect`)).json();
        return { ...data, vacancy: await hh.getVacancy({ externalId }) };
      },
      async submit(input) { return (await fetch(`${origin}/connector/submit`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json(); },
      async reconcile({ operationId }) { return (await fetch(`${origin}/connector/reconcile?operationId=${operationId}`)).json(); } };
    jobs = createJobRuntime({ config: { jobSearchEnabled: true, jobSearchModel: 'fixture-model',
      openrouterApiKey: crypto.randomUUID(), modelTimeoutMs: 5000 }, pool: fixture.pool, interactions,
      fetchImpl: (_url, init) => fetch(`${origin}/model`, init), applicationAdapter,
      send: ({ chatId, answer, buttons }) => bot.api.sendMessage(chatId, answer, buttons?.length ? { reply_markup: telegramReplyMarkup(buttons) } : {}) });
    const menu = new TelegramMenuService({ interactions, jobSearchService: jobs.telegramService });
    const messages = new TelegramMessageService({ accessPolicy: createTelegramAccessPolicy(['101']),
      updateRepository: new TelegramUpdateRepository(fixture.pool), userRepository: new UserRepository(fixture.pool),
      conversationRepository: new ConversationRepository(fixture.pool), menuService: menu });
    bot = createTelegramBot({ token: `5000:${crypto.randomBytes(24).toString('base64url')}`, messageService: messages });
    bot.api.config.use(async (_previous, method, payload) => {
      const response = await fetch(`${origin}/telegram/${method}`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return response.json();
    });
    await bot.init();
    const message = async (text) => {
      await bot.handleUpdate({ update_id: ++updateId, message: { message_id: updateId, date: 1,
        from: { id: 101, is_bot: false, first_name: 'Fixture' }, chat: { id: 101, type: 'private' }, text } });
      return sent.at(-1);
    };
    const callback = async (data) => {
      const update = { update_id: ++updateId, callback_query: { id: String(updateId), from: { id: 101, is_bot: false, first_name: 'Fixture' },
        data, chat_instance: 'fixture', message: { message_id: telegramId, date: 1, chat: { id: 101, type: 'private' } } } };
      await bot.handleUpdate(update); return { update, reply: sent.at(-1) };
    };
    const findButton = (reply, label) => reply.reply_markup.inline_keyboard.flat().find((x) => x.text === label).callback_data;
    await message('/start'); assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data, 'job:menu');
    await callback('job:menu');
    await callback('job:settings');
    let preview = await message('запрос - AI Engineering\nвключить');
    await callback(findButton(preview, 'Подтвердить'));
    await callback('job:profile');
    preview = await message('факт: Participated in a fixture automation project\nпример: Brief factual style.');
    await callback(findButton(preview, 'Подтвердить'));
    await callback('job:base_letter');
    preview = await message('Owner base fixture letter');
    await callback(findButton(preview, 'Подтвердить'));
    collector = createCollectorRuntime({ env: { JARVIS_JOB_SEARCH_ENABLED: 'true' }, pool: fixture.pool,
      hhClient: hh, currencyRates: { async get() { return null; } }, wait: async () => {} });
    await collector.tick();
    assert.equal(modelCalls, 0, 'collection must not call the model');
    const beforeCard = sent.length;
    await jobs.deliveryWorker.tick();
    assert.equal(sent.length, beforeCard + 1);
    const card = sent.at(-1); assert.match(card.text, /Fixture company/);
    assert.equal(card.parse_mode, undefined);
    const chooser = await callback(findButton(card, 'Подготовить отклик'));
    assert.equal(modelCalls, 0);
    const prepared = await callback(findButton(chooser.reply, 'Улучшенное'));
    assert.equal(modelCalls, 1); assert.match(prepared.reply.text, /Fixture cover letter 1/);
    await bot.handleUpdate(prepared.update); assert.equal(modelCalls, 1);
    await callback(findButton(prepared.reply, 'Изменить с AI'));
    const edited = await message('Make it shorter'); assert.match(edited.text, /Fixture cover letter 2/);
    await callback(findButton(edited, 'Перевести с AI'));
    await message('français'); assert.equal(modelCalls, 2);
    const translated = await message('английский'); assert.match(translated.text, /Fixture cover letter 3/);
    assert.equal(modelCalls, 3);
    assert.ok(!upstreamCalls.some((path) => /negotiations/.test(path)), 'preparation must never submit an application');
    assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM job_drafts')).rows[0].n, 3);
    await jobs.deliveryWorker.tick(); assert.equal(sent.at(-1), translated, 'no duplicate card after worker restart');
    await fixture.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'fixture-resume','connected')", [fixture.owner]);
    const applicationPreview = await callback(findButton(translated, 'Отправить отклик'));
    assert.match(applicationPreview.reply.text, /Fixture cover letter 3/); assert.equal(submitCalls, 0);
    const unknown = await callback(findButton(applicationPreview.reply, 'Подтвердить отправку'));
    assert.match(unknown.reply.text, /пока неизвестен/); assert.equal(submitCalls, 1);
    const operationBefore = (await fixture.pool.query('SELECT * FROM job_applications')).rows[0];
    assert.equal(operationBefore.status, 'unknown');
    assert.equal(operationBefore.approved_text, 'Fixture cover letter 3');
    const reconciled = await callback(findButton(unknown.reply, 'Проверить результат'));
    assert.match(reconciled.reply.text, /Источник подтвердил/); assert.equal(submitCalls, 1);
    const operationAfter = (await fixture.pool.query('SELECT * FROM job_applications')).rows[0];
    assert.equal(operationAfter.operation_id, operationBefore.operation_id); assert.equal(operationAfter.status, 'sent');
    assert.equal(modelCalls, 3);
    console.log('PASS E2E including confirmed submission, dropped acknowledgement and read-only reconciliation through a local test connector; live HH capability is not covered');
  } finally {
    await collector?.close(); await jobs?.close();
    await new Promise((resolve) => server.close(resolve)); await fixture.close();
  }
});
