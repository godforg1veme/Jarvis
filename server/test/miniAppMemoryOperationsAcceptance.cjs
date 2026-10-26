const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHmac, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const Fastify = require('fastify');
const { AccessService } = require('../src/access/accessService');
const { registerMiniAppRoutes } = require('../src/miniApp/routes');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');
const { MemoryRepository } = require('../src/memory/memoryRepository');
const { MemoryService } = require('../src/memory/memoryService');
const { MemoryActions } = require('../src/miniApp/memoryActions');

const url = process.env.JARVIS_MINI_TEST_DATABASE_URL || process.env.JARVIS_JOB_TEST_DATABASE_URL;
const origin = 'https://jarvis.example';
const botToken = 'fixture-bot';
const digest = (text) => createHash('sha256').update(text).digest('hex');

function signed(id) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(id), first_name: 'Fixture' }) });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const data = [...params].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}

async function fixture() {
  const schema = `mini_memory_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 8 });
  const app = Fastify();
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    for (const file of ['001_identity_and_conversations.sql', '002_assistant_domain.sql',
      '037_access_mini_app.sql', '051_mini_app_memory_operations.sql']) {
      const sql = (await fs.readFile(path.join(__dirname, '../src/db/migrations', file), 'utf8'))
        .replace(/^CREATE EXTENSION[^;]+;\s*/gm, '');
      await pool.query(sql);
    }
    const accessService = new AccessService({ pool, ownerTelegramId: '101', legacyAllowedIds: ['202'] });
    await accessService.initialize();
    const memoryService = new MemoryService({ repository: new MemoryRepository(pool) });
    registerMiniAppRoutes(app, { pool, accessService,
      config: { miniAppPublicOrigin: origin, telegramBotToken: botToken },
      registerUserRoutes: (routes) => registerMiniAppSelfRoutes(routes, {
        pool, accessService, memoryService, memoryActionService: memoryService,
      }),
    });
    await app.ready();
    async function login(id) {
      const result = await app.inject({ method: 'POST', url: '/mini/api/session',
        headers: { origin }, payload: { initData: signed(id) } });
      assert.equal(result.statusCode, 200);
      return { cookie: result.headers['set-cookie'].split(';')[0], csrf: result.json().csrfToken };
    }
    function request(session, method, endpoint, payload, headers = {}) {
      return app.inject({ method, url: `/mini/api${endpoint}`,
        headers: { cookie: session.cookie,
          ...(method === 'POST' ? { origin, 'x-jarvis-csrf': session.csrf } : {}), ...headers },
        ...(payload !== undefined ? { payload } : {}),
      });
    }
    return { pool, app, accessService, login, request,
      async close() {
        await app.close(); await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
      },
    };
  } catch (error) {
    await app.close(); await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    throw error;
  }
}

test('Mini App memory writes commit with receipts, reconcile, cancel and enforce actor boundaries',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      const owner = await f.login('101');
      const member = await f.login('202');
      const userId = (await f.accessService.getAccessForTelegram('101')).userId;
      const add = { operationId: randomUUID(), kind: 'add', memoryId: null,
        expectedDigest: null, content: 'Я люблю чай' };
      let response = await f.request(owner, 'POST', '/memory/operations', add);
      assert.equal(response.statusCode, 200);
      const memoryId = response.json().memoryId;
      assert.equal(response.json().status, 'completed');
      assert.equal((await f.request(owner, 'GET', `/memory/operations/${add.operationId}`)).json().memoryId, memoryId);
      assert.equal((await f.request(owner, 'POST', '/memory/operations', add)).json().memoryId, memoryId);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [userId])).rows[0].n, 1);
      response = await f.request(owner, 'POST', '/memory/operations', { ...add, content: 'Другая запись' });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, 'operation_conflict');
      assert.equal((await f.request(member, 'GET', `/memory/operations/${add.operationId}`)).statusCode, 404);
      const newOwner = await f.login('101');
      assert.equal((await f.request(newOwner, 'GET', `/memory/operations/${add.operationId}`)).json().memoryId, memoryId);

      const corrected = { operationId: randomUUID(), kind: 'correct', memoryId,
        expectedDigest: digest(add.content), content: 'Я люблю кофе' };
      response = await f.request(owner, 'POST', '/memory/operations', corrected);
      assert.equal(response.statusCode, 200);
      const revisedId = response.json().memoryId;
      assert.notEqual(revisedId, memoryId);
      response = await f.request(owner, 'POST', '/memory/operations',
        { ...corrected, operationId: randomUUID() });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, 'revision_conflict');
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [userId])).rows[0].n, 2);

      const forgotten = { operationId: randomUUID(), kind: 'forget', memoryId: revisedId,
        expectedDigest: digest(corrected.content), content: null };
      response = await f.request(owner, 'POST', '/memory/operations', forgotten);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().memoryId, revisedId);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1 AND active=true', [userId])).rows[0].n, 0);

      const lateId = randomUUID();
      assert.equal((await f.request(owner, 'GET', `/memory/operations/${lateId}`)).statusCode, 404);
      response = await f.request(owner, 'POST', `/memory/operations/${lateId}/cancel`, {});
      assert.equal(response.json().status, 'cancelled');
      assert.equal((await f.request(newOwner, 'GET', `/memory/operations/${lateId}`)).json().status, 'cancelled');
      response = await f.request(owner, 'POST', '/memory/operations', { ...add, operationId: lateId });
      assert.equal(response.json().status, 'cancelled');
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [userId])).rows[0].n, 2);
      response = await f.request(owner, 'POST', `/memory/operations/${add.operationId}/cancel`, {});
      assert.equal(response.json().status, 'completed');

      response = await f.request(owner, 'POST', '/memory/operations',
        { ...add, operationId: randomUUID(), content: 'Мой пароль secret' });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, 'invalid_request');
      response = await f.request(owner, 'POST', '/memory/operations',
        { ...add, operationId: randomUUID() }, { 'x-jarvis-csrf': 'wrong' });
      assert.equal(response.statusCode, 403);
      response = await f.request(owner, 'POST', '/memory/operations',
        { ...add, operationId: randomUUID() }, { origin: 'https://elsewhere.example' });
      assert.equal(response.statusCode, 403);

      const memberId = (await f.accessService.getAccessForTelegram('202')).userId;
      await f.accessService.transaction(async (db) => db.query(`INSERT INTO access_user_overrides
        (user_id,permission,effect) VALUES($1,'memory','deny')`, [memberId]));
      response = await f.request(member, 'POST', '/memory/operations', { ...add, operationId: randomUUID() });
      assert.equal(response.statusCode, 403);
      assert.equal((await f.request(member, 'GET', `/memory/operations/${add.operationId}`)).statusCode, 403);

      const abandoned = { ...add, operationId: randomUUID(), content: 'Я люблю книги' };
      assert.equal((await f.request(owner, 'POST', '/logout', {})).statusCode, 200);
      assert.equal((await f.request(owner, 'POST', '/memory/operations', abandoned)).statusCode, 401);
      assert.equal((await f.request(newOwner, 'POST', `/memory/operations/${abandoned.operationId}/cancel`, {})).json().status, 'cancelled');
      assert.equal((await f.request(newOwner, 'GET', `/memory/operations/${abandoned.operationId}`)).json().status, 'cancelled');
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [userId])).rows[0].n, 2);
    } finally { await f.close(); }
  });

test('memory receipt rolls back with a failed mutation, and cancel serializes a late request',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      const login = await f.login('202');
      const actor = await f.accessService.getAccessForTelegram('202');
      const session = { actor, token: login.cookie.split('=')[1] };
      const original = new MemoryService({ repository: new MemoryRepository(f.pool) });
      const broken = new MemoryActions({ accessService: f.accessService,
        memoryService: { remember: async (args) => {
          await original.remember(args);
          throw new Error('fixture-failure-after-insert');
        } },
      });
      const command = { operationId: randomUUID(), kind: 'add', memoryId: null,
        expectedDigest: null, content: 'Я люблю порядок' };
      await assert.rejects(broken.execute(session, command), /fixture-failure-after-insert/);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [actor.userId])).rows[0].n, 0);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM mini_app_memory_operations WHERE user_id=$1', [actor.userId])).rows[0].n, 0);

      const race = { ...command, operationId: randomUUID() };
      const [write, cancel] = await Promise.all([
        f.request(login, 'POST', '/memory/operations', race),
        f.request(login, 'POST', `/memory/operations/${race.operationId}/cancel`, {}),
      ]);
      assert.equal(write.statusCode, 200);
      assert.equal(cancel.statusCode, 200);
      const final = (await f.request(login, 'GET', `/memory/operations/${race.operationId}`)).json();
      assert.equal(final.status, write.json().status);
      assert.equal(final.status, cancel.json().status);
      const rows = (await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [actor.userId])).rows[0].n;
      assert.equal(rows, final.status === 'completed' ? 1 : 0);
      assert.equal((await f.request(login, 'POST', '/memory/operations', race)).json().status, final.status);
    } finally { await f.close(); }
  });
