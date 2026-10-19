const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { AccessService } = require('../src/access/accessService');
const { JobConnectionSessionRepository } = require('../src/jobs/jobConnectionSessionRepository');
const { JobConnectionSessionService } = require('../src/jobs/jobConnectionSessionService');

const databaseUrl = process.env.JARVIS_JOB_TEST_DATABASE_URL;

async function fixture() {
  if (!databaseUrl) throw new Error('JARVIS_JOB_TEST_DATABASE_URL is required');
  const schema = `job_member_login_${randomBytes(10).toString('hex')}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 8 });
  try {
    for (const name of ['001_identity_and_conversations.sql', '029_job_search.sql',
      '037_access_mini_app.sql', '039_job_member_hh_sessions.sql']) {
      const source = await fs.readFile(path.join(__dirname, '../src/db/migrations', name), 'utf8');
      await pool.query(source.replace(/^CREATE EXTENSION[^;]+;\s*/gm, ''));
    }
    const accessService = new AccessService({ pool, ownerTelegramId: '101', legacyAllowedIds: ['202', '303'] });
    await accessService.initialize();
    const owner = await accessService.getAccessForTelegram('101');
    let member = await accessService.getAccessForTelegram('202');
    let adminMember = await accessService.getAccessForTelegram('303');
    const role = await accessService.mutate(owner.userId, 'role.create', {
      operationId: randomUUID(), name: 'Поиск работы', permissions: ['jobs'],
    });
    member = await accessService.mutate(owner.userId, 'user.update', {
      operationId: randomUUID(), revision: member.revision, roleId: role.id,
    }, '202');
    adminMember = await accessService.mutate(owner.userId, 'user.update', {
      operationId: randomUUID(), revision: adminMember.revision, roleId: role.id, level: 'admin',
    }, '303');

    const profiles = new Map();
    const browserClient = { ownerId: owner.userId, forUser(userId) {
      if (!profiles.has(userId)) {
        const profile = { state: 'waiting', sessionId: null, discarded: [], closed: [] };
        const resumeId = `r${userId.replaceAll('-', '').slice(0, 8)}`;
        const browser = {
          async startLogin({ sessionId }) { profile.sessionId = sessionId; return { ok: true }; },
          async loginStatus({ sessionId }) {
            if (profile.sessionId !== sessionId) throw Object.assign(new Error('JOB_LOGIN_SESSION_INVALID'), { code: 'JOB_LOGIN_SESSION_INVALID' });
            return { state: profile.state, resumes: profile.state === 'authenticated' ? [{ id: resumeId, title: `Resume ${userId}` }] : [], nextSequence: 1 };
          },
          async loginFrame({ sessionId }) { assert.equal(profile.sessionId, sessionId); return { state: 'waiting' }; },
          async loginInput({ sessionId }) { assert.equal(profile.sessionId, sessionId); return { state: 'waiting', nextSequence: 2 }; },
          async listResumes() { return profile.state === 'authenticated' ? [{ id: resumeId, title: `Resume ${userId}` }] : []; },
          async selectResume({ resumeId: selected }) { assert.equal(selected, resumeId); return { ok: true }; },
          async closeLogin({ sessionId }) { profile.closed.push(sessionId); return { ok: true }; },
          async discardLogin({ sessionId }) { profile.discarded.push(sessionId); profile.sessionId = null; return { ok: true }; },
        };
        profiles.set(userId, { profile, browser, resumeId });
      }
      return profiles.get(userId).browser;
    } };
    const service = new JobConnectionSessionService({ repository: new JobConnectionSessionRepository(pool), accessService, browserClient });
    return { pool, admin, schema, accessService, owner, member, adminMember, profiles, browserClient, service };
  } catch (error) {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); throw error;
  }
}

async function dispose(f) {
  await f.pool.end();
  await f.admin.query(`DROP SCHEMA ${f.schema} CASCADE`);
  await f.admin.end();
}

test('PostgreSQL isolates member and admin HH sessions, verifies resume ownership, and revokes live guests',
  { skip: !databaseUrl }, async () => {
    const f = await fixture();
    try {
      const created = await f.service.create({ userId: f.member.userId, requestId: randomUUID() });
      assert.equal(Buffer.from(created.ticket, 'hex').length, 32);
      const claimed = await f.service.claim({ ticket: created.ticket });
      await assert.rejects(f.service.claim({ ticket: created.ticket }), { code: 'JOB_LOGIN_TICKET_INVALID' });
      const retry = await f.service.claim({ ticket: created.ticket, existingGuestToken: claimed.guestToken });
      assert.deepEqual(retry, { ...claimed, replay: true });
      const stored = (await f.pool.query('SELECT ticket_hash,guest_token_hash,status FROM job_hh_login_sessions WHERE id=$1', [created.sessionId])).rows[0];
      assert.equal(stored.ticket_hash, createHash('sha256').update(created.ticket).digest('hex'));
      assert.equal(stored.guest_token_hash, createHash('sha256').update(claimed.guestToken).digest('hex'));
      assert.equal(stored.status, 'claimed');
      await assert.rejects(f.service.loadOwned({ sessionId: created.sessionId, userId: f.adminMember.userId }), { code: 'JOB_LOGIN_SESSION_INVALID' });
      await assert.rejects(f.service.loadOwned({ sessionId: created.sessionId, userId: f.owner.userId }), { code: 'JOB_LOGIN_SESSION_INVALID' });

      f.profiles.get(f.member.userId).profile.state = 'authenticated';
      const authenticated = await f.service.status({ sessionId: created.sessionId, userId: f.member.userId });
      assert.equal(authenticated.status, 'authenticated');
      assert.deepEqual(authenticated.resumes.map((item) => item.id), [f.profiles.get(f.member.userId).resumeId]);
      f.browserClient.forUser(f.adminMember.userId);
      await assert.rejects(f.service.confirm({ sessionId: created.sessionId, userId: f.member.userId, resumeId: f.profiles.get(f.adminMember.userId).resumeId }), { code: 'JOB_LOGIN_RESUME_INVALID' });
      await f.service.confirm({ sessionId: created.sessionId, userId: f.member.userId, resumeId: f.profiles.get(f.member.userId).resumeId });
      await f.service.confirm({ sessionId: created.sessionId, userId: f.member.userId, resumeId: f.profiles.get(f.member.userId).resumeId });
      const rows = (await f.pool.query('SELECT user_id,resume_id,status,revision FROM job_connections ORDER BY user_id')).rows;
      assert.deepEqual(rows, [{ user_id: f.member.userId, resume_id: f.profiles.get(f.member.userId).resumeId, status: 'connected', revision: 1 }]);

      const adminCreated = await f.service.create({ userId: f.adminMember.userId, requestId: randomUUID() });
      const adminClaimed = await f.service.claim({ ticket: adminCreated.ticket });
      const current = await f.accessService.getAccessForTelegram('303');
      await f.accessService.mutate(f.owner.userId, 'user.update', {
        operationId: randomUUID(), revision: current.revision, overrides: { jobs: 'deny' },
      }, '303');
      await assert.rejects(f.service.authorizeGuest({ guestToken: adminClaimed.guestToken }), { code: 'JOB_LOGIN_SESSION_INVALID' });
      const revoked = (await f.pool.query('SELECT status,ticket_hash,guest_token_hash FROM job_hh_login_sessions WHERE id=$1', [adminCreated.sessionId])).rows[0];
      assert.deepEqual(revoked, { status: 'revoked', ticket_hash: null, guest_token_hash: null });
      assert.deepEqual(f.profiles.get(f.adminMember.userId).profile.discarded, [adminCreated.sessionId]);
    } finally { await dispose(f); }
  });

test('PostgreSQL expiry sweep discards only an unconfirmed profile and keeps confirmed connections',
  { skip: !databaseUrl }, async () => {
    const f = await fixture();
    try {
      const created = await f.service.create({ userId: f.member.userId, requestId: randomUUID() });
      await f.service.claim({ ticket: created.ticket });
      await f.pool.query('UPDATE job_hh_login_sessions SET expires_at=now()-interval \'1 second\',ticket_expires_at=now()-interval \'1 second\' WHERE id=$1', [created.sessionId]);
      await f.service.sweepExpired();
      const expired = (await f.pool.query('SELECT status,ticket_hash,guest_token_hash FROM job_hh_login_sessions WHERE id=$1', [created.sessionId])).rows[0];
      assert.deepEqual(expired, { status: 'expired', ticket_hash: null, guest_token_hash: null });
      assert.deepEqual(f.profiles.get(f.member.userId).profile.discarded, [created.sessionId]);

      const confirmed = await f.service.create({ userId: f.adminMember.userId, requestId: randomUUID() });
      const guest = await f.service.claim({ ticket: confirmed.ticket });
      f.profiles.get(f.adminMember.userId).profile.state = 'authenticated';
      const state = await f.service.status({ sessionId: confirmed.sessionId, userId: f.adminMember.userId });
      assert.equal(state.status, 'authenticated');
      await f.service.confirm({ sessionId: confirmed.sessionId, userId: f.adminMember.userId, resumeId: f.profiles.get(f.adminMember.userId).resumeId });
      await f.pool.query('UPDATE job_hh_login_sessions SET expires_at=now()-interval \'1 second\',ticket_expires_at=now()-interval \'1 second\' WHERE id=$1', [confirmed.sessionId]);
      await f.service.sweepExpired();
      assert.deepEqual(f.profiles.get(f.adminMember.userId).profile.discarded, []);
      assert.equal((await f.pool.query('SELECT status FROM job_connections WHERE user_id=$1', [f.adminMember.userId])).rows[0].status, 'connected');
      assert.ok(guest.guestToken);
    } finally { await dispose(f); }
  });
