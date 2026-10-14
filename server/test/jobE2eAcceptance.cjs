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

test('E2E local HTTP + actual grammy bot + handlers + PostgreSQL: configure, collect, deliver, generate, edit, translate and replay', async () => {
  const fixture = await createJobPostgresFixture();
  let updateId = 4000, modelCalls = 0, telegramId = 0;
  const sent = [], upstreamCalls = [];
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
      work_format: [{ id: 'REMOTE' }], published_at: new Date(Date.now() - 60000).toISOString() });
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
    jobs = createJobRuntime({ config: { jobSearchEnabled: true, jobSearchModel: 'fixture-model',
      openrouterApiKey: crypto.randomUUID(), modelTimeoutMs: 5000 }, pool: fixture.pool, interactions,
      fetchImpl: (_url, init) => fetch(`${origin}/model`, init),
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
    collector = createCollectorRuntime({ env: { JARVIS_JOB_SEARCH_ENABLED: 'true' }, pool: fixture.pool,
      hhClient: new HhClient({ baseUrl: `${origin}/hh/`, allowTestHttp: true }), currencyRates: { async get() { return null; } }, wait: async () => {} });
    await collector.tick();
    assert.equal(modelCalls, 0, 'collection must not call the model');
    const beforeCard = sent.length;
    await jobs.deliveryWorker.tick();
    assert.equal(sent.length, beforeCard + 1);
    const card = sent.at(-1); assert.match(card.text, /Fixture company/);
    assert.equal(card.parse_mode, undefined);
    const prepared = await callback(findButton(card, 'Подготовить отклик'));
    assert.equal(modelCalls, 1); assert.match(prepared.reply.text, /Fixture cover letter 1/);
    await bot.handleUpdate(prepared.update); assert.equal(modelCalls, 1);
    await callback(findButton(prepared.reply, 'Изменить'));
    const edited = await message('Make it shorter'); assert.match(edited.text, /Fixture cover letter 2/);
    await callback(findButton(edited, 'Перевести'));
    await message('français'); assert.equal(modelCalls, 2);
    const translated = await message('английский'); assert.match(translated.text, /Fixture cover letter 3/);
    assert.equal(modelCalls, 3);
    assert.ok(!upstreamCalls.some((path) => /negotiations/.test(path)), 'preparation must never submit an application');
    assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM job_drafts')).rows[0].n, 3);
    await jobs.deliveryWorker.tick(); assert.equal(sent.at(-1), translated, 'no duplicate card after worker restart');
    console.log('PASS E2E through local HTTP fixtures, actual grammy dispatch, real handlers and PostgreSQL; live HH submission is not covered');
  } finally {
    await collector?.close(); await jobs?.close();
    await new Promise((resolve) => server.close(resolve)); await fixture.close();
  }
});
