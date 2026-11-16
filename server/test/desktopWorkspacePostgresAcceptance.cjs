const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const Fastify = require('fastify');

const url = process.env.JARVIS_MINI_TEST_DATABASE_URL;
const origin = 'https://jarvis.example';
const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

async function fixture() {
  const schema = `desktop_workspace_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  let pool;
  const app = Fastify();
  try {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 8 });
    for (const name of ['001_identity_and_conversations.sql', '002_assistant_domain.sql',
      '037_access_mini_app.sql', '051_mini_app_memory_operations.sql', '052_mini_app_personal_operations.sql']) {
      const sql = (await fs.readFile(path.join(__dirname, '../src/db/migrations', name), 'utf8'))
        .replace(/^CREATE EXTENSION[^;]+;\s*/gm, '');
      await pool.query(sql);
    }

    const { AccessService } = require('../src/access/accessService');
    const { DeviceRepository } = require('../src/devices/deviceRepository');
    const { createDeviceAuthenticator } = require('../src/devices/deviceAuth');
    const { createDeviceToken, deviceTokenHash } = require('../src/devices/deviceCredentials');
    const { SectionReader } = require('../src/miniApp/sectionReader');
    const { SessionService, sessionCookie } = require('../src/miniApp/sessionService');
    const { ConversationRepository } = require('../src/conversations/conversationRepository');
    const { MemoryRepository } = require('../src/memory/memoryRepository');
    const { MemoryService } = require('../src/memory/memoryService');
    const { registerMiniAppRoutes } = require('../src/miniApp/routes');
    const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');
    const { registerDesktopWorkspaceRoutes } = require('../src/desktop/workspaceRoutes');

    const accessService = new AccessService({ pool, ownerTelegramId: '101', legacyAllowedIds: ['202'] });
    await accessService.initialize();
    const owner = await accessService.getAccessForTelegram('101');
    const member = await accessService.getAccessForTelegram('202');
    assert.ok(owner?.userId && member?.userId);
    const devices = new DeviceRepository(pool);
    const ownerToken = createDeviceToken();
    const memberToken = createDeviceToken();
    const insertDevice = async (userId, token, name) => (await pool.query(`
      INSERT INTO devices(user_id,name,token_hash,status)
      VALUES($1,$2,$3,'online') RETURNING id
    `, [userId, name, deviceTokenHash(token)])).rows[0].id;
    const ownerDeviceId = await insertDevice(owner.userId, ownerToken, 'Acceptance owner');
    const memberDeviceId = await insertDevice(member.userId, memberToken, 'Acceptance member');
    const conversationRepository = new ConversationRepository(pool);
    const sectionReader = new SectionReader({ pool });
    const memoryService = new MemoryService({ repository: new MemoryRepository(pool) });
    const services = { pool, accessService, sectionReader, conversationRepository,
      memoryService, memoryActionService: memoryService };

    // Both clients use the production route registration and production session/auth services.
    registerMiniAppRoutes(app, { pool, accessService, config: { miniAppPublicOrigin: origin },
      registerUserRoutes: (routes) => registerMiniAppSelfRoutes(routes, services) });
    registerDesktopWorkspaceRoutes(app, { ...services,
      authenticate: createDeviceAuthenticator(devices),
    });
    await app.ready();

    const desktop = (token, method, endpoint, payload) => app.inject({ method,
      url: `/v1/desktop/workspace${endpoint}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
    const sessionService = new SessionService({ pool, accessService });
    async function miniSession(telegramId) {
      const session = await sessionService.create(telegramId);
      return { cookie: sessionCookie(session.token).split(';')[0], csrfToken: session.csrfToken };
    }
    const mini = (session, method, endpoint, payload, extra = {}) => app.inject({ method,
      url: `/mini/api${endpoint}`,
      headers: { cookie: session.cookie,
        ...(method === 'POST' ? { origin, 'x-jarvis-csrf': session.csrfToken } : {}), ...extra },
      ...(payload === undefined ? {} : { payload }),
    });
    return { admin, pool, app, accessService, devices, owner, member, ownerToken, memberToken,
      ownerDeviceId, memberDeviceId, sectionReader, memoryService, sessionService,
      desktop, mini, miniSession,
      async close() {
        await app.close(); await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
      },
    };
  } catch (error) {
    await app.close().catch(() => {});
    if (pool) await pool.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
    throw error;
  }
}

test('Desktop bearer is checked against PostgreSQL bytea token hash and SectionReader returns scoped memory',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      const me = await f.desktop(f.ownerToken, 'GET', '/me');
      assert.equal(me.statusCode, 200, me.body);
      assert.equal(me.json().actor.userId, f.owner.userId);
      const write = await f.memoryService.remember({ userId: f.owner.userId, content: 'Desktop workspace acceptance fact' });
      assert.equal(write.ok, true);
      const section = await f.desktop(f.ownerToken, 'GET', '/sections/memory');
      assert.equal(section.statusCode, 200, section.body);
      assert.equal(section.json().items.some((row) => row.id === write.memory.id), true);
    } finally { await f.close(); }
  });

test('Desktop memory add deduplicates, conflicts on changed payload, and the Mini App session reads the same receipt and row',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      const session = await f.miniSession('101');
      const command = { operationId: randomUUID(), kind: 'add', memoryId: null,
        expectedDigest: null, content: 'Одинаковая запись для двух клиентов' };
      const first = await f.desktop(f.ownerToken, 'POST', '/memory/operations', command);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().status, 'completed');
      const repeated = await f.desktop(f.ownerToken, 'POST', '/memory/operations', command);
      assert.equal(repeated.statusCode, 200, repeated.body);
      assert.equal(repeated.json().memoryId, first.json().memoryId);
      const conflict = await f.desktop(f.ownerToken, 'POST', '/memory/operations', { ...command, content: 'Иной текст' });
      assert.equal(conflict.statusCode, 409, conflict.body);
      assert.equal(conflict.json().code, 'operation_conflict');

      const miniRetry = await f.mini(session, 'POST', '/memory/operations', command);
      assert.equal(miniRetry.statusCode, 200, miniRetry.body);
      assert.equal(miniRetry.json().memoryId, first.json().memoryId);
      const rows = await f.mini(session, 'GET', '/sections/memory');
      assert.equal(rows.statusCode, 200, rows.body);
      assert.equal(rows.json().items.filter((row) => row.id === first.json().memoryId).length, 1);
      const count = await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1 AND active=true', [f.owner.userId]);
      assert.equal(count.rows[0].n, 1);
    } finally { await f.close(); }
  });

test('Desktop memory correction and forgetting use current content digest and commit receipts transactionally',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      const initial = await f.memoryService.remember({ userId: f.owner.userId, content: 'Предпочитает чай' });
      const corrected = await f.desktop(f.ownerToken, 'POST', '/memory/operations', {
        operationId: randomUUID(), kind: 'correct', memoryId: initial.memory.id,
        expectedDigest: digest(initial.memory.content), content: 'Предпочитает кофе',
      });
      assert.equal(corrected.statusCode, 200, corrected.body);
      assert.notEqual(corrected.json().memoryId, initial.memory.id);
      const stale = await f.desktop(f.ownerToken, 'POST', '/memory/operations', {
        operationId: randomUUID(), kind: 'forget', memoryId: initial.memory.id,
        expectedDigest: digest(initial.memory.content), content: null,
      });
      assert.equal(stale.statusCode, 409, stale.body);
      const forget = await f.desktop(f.ownerToken, 'POST', '/memory/operations', {
        operationId: randomUUID(), kind: 'forget', memoryId: corrected.json().memoryId,
        expectedDigest: digest('Предпочитает кофе'), content: null,
      });
      assert.equal(forget.statusCode, 200, forget.body);
      const active = await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1 AND active=true', [f.owner.userId]);
      assert.equal(active.rows[0].n, 0);
      const versions = await f.pool.query('SELECT count(*)::int AS n FROM memory_versions WHERE user_id=$1', [f.owner.userId]);
      // Remember writes one version, correction archives the old row and adds
      // the replacement, and forgetting archives the replacement once more.
      assert.equal(versions.rows[0].n, 4);
    } finally { await f.close(); }
  });

test('Another user cannot read an operation or replay a foreign SectionReader cursor',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      const command = { operationId: randomUUID(), kind: 'add', memoryId: null,
        expectedDigest: null, content: 'Owner only memory' };
      const created = await f.desktop(f.ownerToken, 'POST', '/memory/operations', command);
      assert.equal(created.statusCode, 200, created.body);
      const foreignReceipt = await f.desktop(f.memberToken, 'GET', `/memory/operations/${command.operationId}`);
      assert.equal(foreignReceipt.statusCode, 404, foreignReceipt.body);
      const inserted = await f.pool.query('INSERT INTO memories(user_id,kind,content) SELECT $1,\'fact\',$2 FROM generate_series(1,35) RETURNING id',
        [f.owner.userId, 'owner cursor row']);
      assert.equal(inserted.rowCount, 35);
      const firstPage = await f.desktop(f.ownerToken, 'GET', '/sections/memory');
      assert.equal(firstPage.statusCode, 200, firstPage.body);
      const cursor = firstPage.json().paging.nextCursor;
      assert.equal(typeof cursor, 'string');
      const ownerPage = await f.desktop(f.ownerToken, 'GET', `/sections/memory/page/${cursor}`);
      assert.equal(ownerPage.statusCode, 200, ownerPage.body);
      assert.ok(ownerPage.json().items.length > 0);
      const foreignCursor = await f.desktop(f.memberToken, 'GET', `/sections/memory/page/${cursor}`);
      assert.equal(foreignCursor.statusCode, 400, foreignCursor.body);
      assert.equal(foreignCursor.json().code, 'invalid_request');
      const memberRows = await f.desktop(f.memberToken, 'GET', '/sections/memory');
      assert.equal(memberRows.statusCode, 200, memberRows.body);
      assert.equal(memberRows.json().items.length, 0);
    } finally { await f.close(); }
  });

test('Revoking a device after an authorized snapshot blocks later reads and writes',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      assert.equal((await f.desktop(f.ownerToken, 'GET', '/me')).statusCode, 200);
      const revoke = await f.devices.revokeForUser({ userId: f.owner.userId, deviceId: f.ownerDeviceId });
      assert.ok(revoke);
      const read = await f.desktop(f.ownerToken, 'GET', '/sections/memory');
      assert.equal(read.statusCode, 401, read.body);
      const write = await f.desktop(f.ownerToken, 'POST', '/memory/operations', {
        operationId: randomUUID(), kind: 'add', memoryId: null, expectedDigest: null, content: 'Must not be written',
      });
      assert.equal(write.statusCode, 401, write.body);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [f.owner.userId])).rows[0].n, 0);
    } finally { await f.close(); }
  });

test('Removing memory permission after an authorized snapshot blocks reads and mutations',
  { skip: !url }, async () => {
    const f = await fixture();
    try {
      assert.equal((await f.desktop(f.memberToken, 'GET', '/me')).statusCode, 200);
      await f.accessService.transaction((db) => db.query(`INSERT INTO access_user_overrides(user_id,permission,effect)
        VALUES($1,'memory','deny') ON CONFLICT(user_id,permission) DO UPDATE SET effect='deny'`, [f.member.userId]));
      const read = await f.desktop(f.memberToken, 'GET', '/sections/memory');
      assert.equal(read.statusCode, 403, read.body);
      const write = await f.desktop(f.memberToken, 'POST', '/memory/operations', {
        operationId: randomUUID(), kind: 'add', memoryId: null, expectedDigest: null, content: 'Must not be written',
      });
      assert.equal(write.statusCode, 403, write.body);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM memories WHERE user_id=$1', [f.member.userId])).rows[0].n, 0);
    } finally { await f.close(); }
  });
