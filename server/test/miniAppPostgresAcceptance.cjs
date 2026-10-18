const test = require('node:test'),
  assert = require('node:assert/strict'),
  { randomBytes, randomUUID, createHmac } = require('node:crypto');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { Pool } = require('pg'),
  Fastify = require('fastify');
const { AccessService } = require('../src/access/accessService');
const { registerMiniAppRoutes } = require('../src/miniApp/routes');
const url =
  process.env.JARVIS_MINI_TEST_DATABASE_URL ||
  process.env.JARVIS_JOB_TEST_DATABASE_URL;
async function fixture() {
  const schema = `mini_test_${randomBytes(10).toString('hex')}`,
    admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
    max: 8,
  });
  try {
    for (const file of [
      '001_identity_and_conversations.sql',
      '037_access_mini_app.sql',
    ])
      await pool.query(
        (
          await fs.readFile(
            path.join(__dirname, '../src/db/migrations', file),
            'utf8',
          )
        ).replace(/^CREATE EXTENSION[^;]+;\s*/gm, ''),
      );
    const service = new AccessService({
      pool,
      ownerTelegramId: '101',
      legacyAllowedIds: ['202'],
    });
    await service.initialize();
    return {
      pool,
      service,
      async close() {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  } catch (e) {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw e;
  }
}
test(
  'isolated PostgreSQL authority: CAS, dedup, concurrent writes, actor scope, overrides, owner protection and bootstrap',
  { skip: !url },
  async () => {
    const f = await fixture();
    try {
      const owner = await f.service.getAccessForTelegram('101'),
        member = await f.service.getAccessForTelegram('202');
      assert.equal(owner.level, 'owner');
      assert.equal(
        (
          await f.pool.query('SELECT role FROM users WHERE id=$1', [
            owner.userId,
          ])
        ).rows[0].role,
        'owner',
      );
      assert.deepEqual(member.permissions, [
        'assistant',
        'life',
        'memory',
        'documents',
        'devices',
      ]);
      const rolePayload = {
        operationId: randomUUID(),
        name: 'Поиск',
        permissions: ['jobs'],
      };
      const role = await f.service.mutate(
        owner.userId,
        'role.create',
        rolePayload,
      );
      assert.deepEqual(
        await f.service.mutate(owner.userId, 'role.create', rolePayload),
        role,
      );
      await assert.rejects(
        f.service.mutate(owner.userId, 'role.create', {
          ...rolePayload,
          name: 'Different',
        }),
        { code: 'operation_conflict' },
      );
      let updated = await f.service.mutate(
        owner.userId,
        'user.update',
        {
          operationId: randomUUID(),
          revision: member.revision,
          roleId: role.id,
          overrides: { jobs: 'deny', life: 'allow' },
        },
        '202',
      );
      assert.deepEqual(updated.permissions, ['life']);
      const changes = await Promise.allSettled(
        [true, false].map((blocked) =>
          f.service.mutate(
            owner.userId,
            'user.update',
            { operationId: randomUUID(), revision: updated.revision, blocked },
            '202',
          ),
        ),
      );
      assert.equal(changes.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        changes.find((r) => r.status === 'rejected').reason.code,
        'revision_conflict',
      );
      await f.service.initialize();
      let current = await f.service.getAccessForTelegram('202');
      assert.equal(current.revision, updated.revision + 1);
      assert.equal(current.blocked, true);
      assert.deepEqual(current.overrides, { jobs: 'deny', life: 'allow' });
      await assert.rejects(
        f.service.mutate(
          owner.userId,
          'user.update',
          {
            operationId: randomUUID(),
            revision: owner.revision,
            blocked: true,
          },
          '101',
        ),
        { code: 'protected_owner' },
      );
      const admin = await f.service.mutate(owner.userId, 'user.create', {
        operationId: randomUUID(),
        telegramId: '303',
        displayName: 'Admin',
        roleId: null,
        level: 'admin',
      });
      await assert.rejects(
        f.service.mutate(
          admin.userId,
          'user.update',
          {
            operationId: randomUUID(),
            revision: admin.revision,
            level: 'member',
          },
          '303',
        ),
        { code: 'forbidden' },
      );
      await assert.rejects(
        f.service.mutate(admin.userId, 'user.create', {
          operationId: randomUUID(),
          telegramId: '404',
          displayName: 'Escalation',
          roleId: null,
          level: 'admin',
        }),
        { code: 'forbidden' },
      );
      await assert.rejects(
        f.service.getOperation(admin.userId, rolePayload.operationId),
        { code: 'operation_unknown' },
      );
      const ownRole = await f.service.mutate(
        admin.userId,
        'role.create',
        rolePayload,
      );
      assert.notEqual(ownRole.id, role.id);
      assert.equal(await f.service.isAllowedTelegram('909'), false);
      assert.equal(await f.service.isAllowedTelegram('202'), false);
      assert.equal(
        (await f.service.listAdmin(admin.userId)).users.some(
          (u) => 'messages' in u || 'email' in u,
        ),
        false,
      );
      const beforeRoleChange = await f.service.getAccessForTelegram('202');
      const roleChanged = await f.service.mutate(
        admin.userId,
        'role.update',
        {
          operationId: randomUUID(),
          revision: role.revision,
          name: 'Поиск и память',
          permissions: ['jobs', 'memory'],
        },
        role.id,
      );
      assert.equal(roleChanged.revision, 2);
      assert.equal((await f.service.getAccessForTelegram('202')).revision, beforeRoleChange.revision + 1);
      await assert.rejects(f.service.mutate(owner.userId, 'user.update', {
        operationId: randomUUID(), revision: beforeRoleChange.revision, blocked: false,
      }, '202'), { code: 'revision_conflict' });
      await assert.rejects(
        f.service.mutate(
          owner.userId,
          'role.update',
          {
            operationId: randomUUID(),
            revision: role.revision,
            name: 'Stale',
            permissions: [],
          },
          role.id,
        ),
        { code: 'revision_conflict' },
      );
      current = await f.service.getAccessForTelegram('202');
      await f.service.mutate(
        owner.userId,
        'user.update',
        {
          operationId: randomUUID(),
          revision: current.revision,
          blocked: false,
        },
        '202',
      );
      assert.deepEqual(
        (await f.service.getAccessForTelegram('202')).permissions,
        ['life', 'memory'],
      );
      await assert.rejects(
        f.pool.query(
          'INSERT INTO access_role_permissions(role_id,permission) VALUES($1,$2)',
          [role.id, 'private_data'],
        ),
        { code: '23514' },
      );
    } finally {
      await f.close();
    }
  },
);
test(
  'real session routes validate login, revoke cookie, enforce CSRF and fresh privileges',
  { skip: !url },
  async () => {
    const f = await fixture(),
      app = Fastify({ logger: false }),
      origin = 'https://jarvis.example',
      botToken = 'fixture-bot';
    registerMiniAppRoutes(app, {
      config: { miniAppPublicOrigin: origin, telegramBotToken: botToken },
      accessService: f.service,
      pool: f.pool,
    });
    function signed(id) {
      const p = new URLSearchParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id, first_name: 'Fixture' }),
      });
      const secret = createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();
      p.set(
        'hash',
        createHmac('sha256', secret)
          .update(
            [...p]
              .sort(([a], [b]) => a.localeCompare(b, 'en'))
              .map(([k, v]) => `${k}=${v}`)
              .join('\n'),
          )
          .digest('hex'),
      );
      return p.toString();
    }
    async function login(id) {
      return app.inject({
        method: 'POST',
        url: '/mini/api/session',
        headers: { origin },
        payload: { initData: signed(id) },
      });
    }
    try {
      let r = await login(101);
      assert.equal(r.statusCode, 200);
      let cookie = r.headers['set-cookie'].split(';')[0],
        csrf = r.json().csrfToken;
      const db = (await f.pool.query('SELECT * FROM mini_app_sessions'))
        .rows[0];
      assert.equal(cookie.includes(db.token_hash), false);
      assert.notEqual(db.csrf_hash, csrf);
      r = await app.inject({ url: '/mini/api/me', headers: { cookie } });
      assert.equal(r.json().actor.level, 'owner');
      assert.equal(r.json().csrfToken, csrf);
      r = await app.inject({
        method: 'POST',
        url: '/mini/api/admin/roles',
        headers: { cookie, origin },
        payload: { operationId: randomUUID(), name: 'R', permissions: [] },
      });
      assert.equal(r.json().code, 'invalid_csrf');
      r = await app.inject({
        method: 'POST',
        url: '/mini/api/admin/roles',
        headers: { cookie, origin, 'x-jarvis-csrf': csrf },
        payload: {
          operationId: randomUUID(),
          name: 'R',
          permissions: [],
          level: 'owner',
        },
      });
      assert.equal(r.json().code, 'invalid_request');
      r = await app.inject({
        method: 'POST',
        url: '/mini/api/logout',
        headers: { cookie, origin, 'x-jarvis-csrf': csrf },
      });
      assert.equal(r.json().ok, true);
      r = await app.inject({ url: '/mini/api/me', headers: { cookie } });
      assert.equal(r.statusCode, 401);
      r = await login(202);
      cookie = r.headers['set-cookie'].split(';')[0];
      const owner = await f.service.getAccessForTelegram('101'),
        member = await f.service.getAccessForTelegram('202');
      await f.service.mutate(
        owner.userId,
        'user.update',
        { operationId: randomUUID(), revision: member.revision, blocked: true },
        '202',
      );
      r = await app.inject({ url: '/mini/api/me', headers: { cookie } });
      assert.equal(r.statusCode, 401);
      assert.equal((await login(202)).statusCode, 403);
      const blocked = await f.service.getAccessForTelegram('202');
      await f.service.mutate(
        owner.userId,
        'user.update',
        {
          operationId: randomUUID(),
          revision: blocked.revision,
          blocked: false,
        },
        '202',
      );
      assert.equal(
        (await app.inject({ url: '/mini/api/me', headers: { cookie } }))
          .statusCode,
        401,
      );
      assert.equal((await login(999)).statusCode, 403);
      const staleSession = await login(202);
      const staleCookie = staleSession.headers['set-cookie'].split(';')[0];
      await f.pool.query(
        "UPDATE user_identities SET user_id=$1 WHERE provider='telegram' AND external_id='202'",
        [owner.userId],
      );
      assert.equal(await f.service.getAccessForTelegram('202'), null);
      assert.equal(await f.service.getAccessForUser(member.userId), null);
      assert.equal(
        (
          await app.inject({
            url: '/mini/api/me',
            headers: { cookie: staleCookie },
          })
        ).statusCode,
        403,
      );
      r = await login(101);
      cookie = r.headers['set-cookie'].split(';')[0];
      await f.pool.query(
        "UPDATE mini_app_sessions SET expires_at=now()-interval '1 second'",
      );
      assert.equal(
        (await app.inject({ url: '/mini/api/me', headers: { cookie } }))
          .statusCode,
        401,
      );
    } finally {
      await app.close();
      await f.close();
    }
  },
);
