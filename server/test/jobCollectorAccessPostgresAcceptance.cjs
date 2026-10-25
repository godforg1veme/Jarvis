const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { AccessService } = require('../src/access/accessService');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { createCollectorRuntime } = require('../src/jobs/collectorMain');

test('collector uses current roles and personal grants for separate users, and stops on revocation', async () => {
  if (!process.env.JARVIS_JOB_TEST_DATABASE_URL) throw new Error('Isolated JARVIS_JOB_TEST_DATABASE_URL required');
  const schema = `collector_access_${randomBytes(10).toString('hex')}`;
  const admin = new Pool({ connectionString: process.env.JARVIS_JOB_TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.JARVIS_JOB_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 8 });
  let runtime;
  try {
    for (const name of ['001_identity_and_conversations.sql', '029_job_search.sql', '037_access_mini_app.sql', '047_job_fresh_collection.sql', '048_job_reconciliation.sql']) {
      const source = await fs.readFile(path.join(__dirname, '../src/db/migrations', name), 'utf8');
      await pool.query(source.replace(/^CREATE EXTENSION[^;]+;\s*/gm, ''));
    }
    const access = new AccessService({ pool, ownerTelegramId: '101' });
    await access.initialize();
    const owner = await access.getAccessForTelegram('101');
    const jobsRole = await access.mutate(owner.userId, 'role.create', { operationId: randomUUID(), name: 'Jobs fixture', permissions: ['jobs'] });
    const emptyRole = await access.mutate(owner.userId, 'role.create', { operationId: randomUUID(), name: 'No jobs fixture', permissions: [] });
    const people = [{ ...owner, expected: true }];
    for (const [telegramId, level, roleId, overrides, blocked, expected] of [
      ['202', 'member', jobsRole.id, {}, false, true],
      ['303', 'member', emptyRole.id, { jobs: 'allow' }, false, true],
      ['404', 'admin', emptyRole.id, { jobs: 'deny' }, false, false],
      ['505', 'member', jobsRole.id, {}, true, false],
      ['606', 'member', emptyRole.id, {}, false, false],
      ['707', 'admin', emptyRole.id, {}, false, true],
    ]) {
      let person = await access.mutate(owner.userId, 'user.create', {
        operationId: randomUUID(), telegramId, displayName: `Fixture ${telegramId}`, level, roleId,
      });
      person = await access.mutate(owner.userId, 'user.update', {
        operationId: randomUUID(), revision: person.revision, overrides, blocked,
      }, telegramId);
      people.push({ ...person, expected });
    }
    // Preserve active settings even for a user whose access has since been removed.
    for (const person of people) {
      const conversation = (await pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram',$2) RETURNING id", [person.userId, person.telegramId])).rows[0].id;
      await pool.query(`INSERT INTO job_searches(user_id,conversation_id,chat_id,settings,next_check_at)
        VALUES($1,$2,$3,$4,now()-interval '1 minute')`, [person.userId, conversation, person.telegramId,
        { queries: [`fixture ${person.telegramId}`], activated: true, paused: false, historyDays: 1, intervalMs: 60000 }]);
    }
    // A full first page of old revoked searches must not starve permitted users.
    for (let i = 0; i < 101; i++) {
      const telegramId = String(10000 + i);
      const userId = (await pool.query("INSERT INTO users(display_name,role) VALUES('Revoked fixture','member') RETURNING id")).rows[0].id;
      await pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram',$2)", [userId, telegramId]);
      await pool.query("INSERT INTO access_memberships(user_id,telegram_id,role_id,level) VALUES($1,$2,$3,'member')", [userId, telegramId, emptyRole.id]);
      const conversation = (await pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram',$2) RETURNING id", [userId, telegramId])).rows[0].id;
      await pool.query(`INSERT INTO job_searches(user_id,conversation_id,chat_id,settings,next_check_at)
        VALUES($1,$2,$3,$4,now()-interval '1 day')`, [userId, conversation, telegramId,
        { queries: ['denied fixture'], activated: true, paused: false, historyDays: 1, intervalMs: 60000 }]);
    }
    const scopes = [];
    runtime = createCollectorRuntime({ pool,
      env: { JARVIS_JOB_SEARCH_ENABLED: 'true', JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: '101' },
      currencyRates: { async get() { return null; } }, wait: async () => {},
      hhClient: { forUser(userId) { return { async search(args) {
        scopes.push({ userId, query: args.query }); return { items: [], found: 0, pages: 0 };
      } }; } },
    });
    await runtime.tick();
    assert.deepEqual(scopes.map(s => s.userId).sort(), people.filter(p => p.expected).flatMap(p => [p.userId, p.userId]).sort(),
      'fresh and history both use current personal access');
    for (const scope of scopes) assert.equal(scope.query, `fixture ${people.find(p => p.userId === scope.userId).telegramId}`);
    const roleMember = await access.getAccessForTelegram('202');
    await access.mutate(owner.userId, 'role.update', {
      operationId: randomUUID(), revision: jobsRole.revision, name: jobsRole.name, permissions: [],
    }, jobsRole.id);
    const personalMember = await access.getAccessForTelegram('303');
    await access.mutate(owner.userId, 'user.update', {
      operationId: randomUUID(), revision: personalMember.revision, overrides: { jobs: 'deny' },
    }, '303');
    await pool.query("UPDATE job_searches SET next_check_at=now()-interval '1 minute'");
    scopes.length = 0;
    await runtime.tick();
    assert.deepEqual(scopes.map(s => s.userId).sort(), [owner.userId, people.find(p => p.telegramId === '707').userId].sort());
    const searches = new JobSearchRepository(pool, { accessService: configuredOwnerJobAccess(pool, '101') });
    await assert.rejects(searches.claimSearch({ userId: roleMember.userId, now: new Date(), force: true }), { code: 'JOB_SCOPE_DENIED' });
    // A lease obtained before revocation cannot authorize further browser requests.
    const adminPerson = people.find(p => p.telegramId === '707');
    const lease = await searches.claimSearch({ userId: adminPerson.userId, now: new Date(), force: true });
    const current = await access.getAccessForTelegram('707');
    await access.mutate(owner.userId, 'user.update', { operationId: randomUUID(), revision: current.revision, blocked: true }, '707');
    assert.equal(await searches.renewSearch({ userId: adminPerson.userId, leaseId: lease.lease_id, revision: lease.revision, now: new Date() }), false);
  } finally {
    await runtime?.close(); await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
