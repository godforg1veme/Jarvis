const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { loadConfig } = require('../src/config/loadConfig');
const { createRuntime } = require('../src/runtime');
const { listMigrationFiles, runMigrations } = require('../src/db/migrate');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');

test('full runtime with real pgvector: all migrations twice, health, real bot home and job path', async () => {
  if (!process.env.JARVIS_JOB_TEST_DATABASE_URL) throw new Error('Explicit local test database URL is required');
  const adminUrl = new URL(process.env.JARVIS_JOB_TEST_DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(adminUrl.hostname)) throw new Error('Full runtime acceptance requires a local test server');
  const admin = new Pool({ connectionString: adminUrl.href });
  const databaseName = `job_runtime_test_${crypto.randomBytes(10).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${databaseName}`);
  const databaseUrl = new URL(adminUrl); databaseUrl.pathname = `/${databaseName}`;
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-job-runtime-'));
  let runtime, pool;
  try {
    pool = new Pool({ connectionString: databaseUrl.href });
    const config = { ...loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent', DATABASE_URL: databaseUrl.href,
      TELEGRAM_BOT_TOKEN: `5000:${crypto.randomBytes(24).toString('base64url')}`, TELEGRAM_ALLOWED_IDS: '101',
      JARVIS_JOB_SEARCH_ENABLED: 'true', JARVIS_JOB_MODEL: 'fixture-model',
      JARVIS_DOCUMENT_STORAGE_PATH: storage }), port: 0 };
    runtime = await createRuntime(config, { pool });
    assert.ok(runtime.jobRuntime, 'actual server wiring must expose the job runtime');
    await runMigrations(pool);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, listMigrationFiles().length);
    assert.equal((await pool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rowCount, 1);
    const owner = (await pool.query("INSERT INTO users(display_name,role) VALUES('Fixture owner','owner') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [owner]);
    const sent = [];
    runtime.bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'getMe') return { ok: true, result: { id: 5000, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' } };
      if (method === 'answerCallbackQuery') return { ok: true, result: true };
      if (method === 'sendMessage') { sent.push(payload); return { ok: true, result: { message_id: sent.length, date: 1,
        chat: { id: 101, type: 'private' }, text: payload.text } }; }
      throw new Error('Unexpected live API call prevented');
    });
    await runtime.bot.init();
    runtime.bot.start = async () => {}; // No long polling; dispatch below uses the real registered handlers.
    await runtime.start();
    runtime.jobRuntime.deliveryWorker.stop(); // Explicit tick below makes transport assertions deterministic.
    assert.equal((await runtime.app.inject('/health/live')).statusCode, 200);
    assert.equal((await runtime.app.inject('/health/ready')).statusCode, 200);
    await runtime.bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 1,
      from: { id: 101, is_bot: false, first_name: 'Fixture' }, chat: { id: 101, type: 'private' }, text: '/start' } });
    assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data, 'job:menu');
    assert.ok(sent.some((payload) => payload.reply_markup?.keyboard?.flat().some((button) => button.text === '💼 Поиск работы')),
      'registered bot /start sends the new persistent owner job button');
    await runtime.bot.handleUpdate({ update_id: 2, callback_query: { id: '2', chat_instance: 'fixture',
      from: { id: 101, is_bot: false, first_name: 'Fixture' }, data: 'job:menu',
      message: { message_id: 1, date: 1, chat: { id: 101, type: 'private' } } } });
    assert.match(sent.at(-1).text, /Поиск работы/);
    assert.deepEqual(sent.at(-1).link_preview_options, { is_disabled: true }, 'manual job responses suppress previews');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM job_searches')).rows[0].n, 1);
    const search = new JobSearchRepository(pool), deliveries = new JobDeliveryRepository(pool);
    const vacancy = await search.upsertVacancy({ externalId: '123', snapshot: {
      title: 'Fixture AI vacancy', company: 'Fixture', url: 'https://hh.ru/vacancy/123', publishedAt: '2026-10-15T12:00:00Z', description: 'Fixture' } });
    await search.recordMatch({ userId: owner, vacancyId: vacancy.id, filterRevision: 1 });
    await deliveries.enqueue({ userId: owner, vacancyId: vacancy.id });
    await runtime.jobRuntime.deliveryWorker.tick();
    assert.match(sent.at(-1).text, /Fixture AI vacancy/);
    assert.deepEqual(sent.at(-1).link_preview_options, { is_disabled: true }, 'scheduled deliveries use the actual runtime sendMessage options');
    assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].url, 'https://hh.ru/vacancy/123');
    console.log(`PASS full runtime: ${listMigrationFiles().length} actual migrations, real pgvector, health and registered bot job route`);
  } finally {
    if (runtime) await runtime.close(); else if (pool) await pool.end();
    await admin.query(`DROP DATABASE ${databaseName}`); await admin.end();
    // Only the unique empty fixture storage directory is removed.
    await fs.rmdir(storage).catch(() => {});
  }
});
