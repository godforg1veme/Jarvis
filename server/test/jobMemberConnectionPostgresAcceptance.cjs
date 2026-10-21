const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { AccessService } = require('../src/access/accessService');
const { JobConnectionSessionRepository } = require('../src/jobs/jobConnectionSessionRepository');
const { JobConnectionSessionService } = require('../src/jobs/jobConnectionSessionService');
const { JobLoginLinkDelivery } = require('../src/jobs/jobLoginLinkDelivery');

const databaseUrl = process.env.JARVIS_JOB_TEST_DATABASE_URL;

async function fixture() {
  if (!databaseUrl) throw new Error('JARVIS_JOB_TEST_DATABASE_URL is required');
  const schema = `job_member_login_${randomBytes(10).toString('hex')}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 8 });
  try {
    for (const name of ['001_identity_and_conversations.sql', '015_telegram_interactions.sql',
      '024_telegram_update_outcomes.sql', '025_telegram_update_kind.sql', '029_job_search.sql',
      '037_access_mini_app.sql', '039_job_member_hh_sessions.sql', '040_job_hh_login_delivery.sql']) {
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
    const service = new JobConnectionSessionService({ repository: new JobConnectionSessionRepository(pool), accessService, browserClient,
      ticketSecret: 'test-only-hh-login-ticket-secret-123456' });
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

test('PostgreSQL private link delivery is single-claim across concurrent requests and restarts',
  { skip: !databaseUrl }, async () => {
    const f = await fixture(); let finishSend;
    try {
      await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','202')", [f.member.userId]);
      let sends = 0, sent;
      const pending = new Promise((resolve) => { finishSend = resolve; });
      const delivery = new JobLoginLinkDelivery({ sessions: f.service, repository: f.service.repository,
        origin: 'https://jarvis.example', send: async (message) => { sends++; sent = message; await pending; } });
      const requestId = randomUUID();
      const first = delivery.create({ userId: f.member.userId, requestId });
      for (let i = 0; i < 50 && !sends; i++) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(sends, 1);
      const concurrent = await delivery.create({ userId: f.member.userId, requestId });
      assert.equal(concurrent.telegramDelivery, 'unknown'); assert.equal(sends, 1);
      finishSend(); const completed = await first;
      assert.equal(completed.telegramDelivery, 'sent'); assert.equal(sent.chatId, '202');
      assert.equal(sent.buttons[0][0].url, `https://jarvis.example/mini/job-connect/#ticket=${completed.ticket}`);
      assert.ok(sent.answer.includes(sent.buttons[0][0].url));
      const replay = new JobLoginLinkDelivery({ sessions: f.service, repository: f.service.repository,
        origin: 'https://jarvis.example', send: async () => { sends++; } });
      const afterRestart = await replay.create({ userId: f.member.userId, requestId });
      assert.equal(afterRestart.ticket, completed.ticket); assert.equal(afterRestart.telegramDelivery, 'sent');
      assert.equal(afterRestart.expiresAt, completed.expiresAt); assert.equal(sends, 1);
      const stored = (await f.pool.query('SELECT to_jsonb(s)::text AS value FROM job_hh_login_sessions s WHERE id=$1', [completed.sessionId])).rows[0].value;
      assert.equal(stored.includes(completed.ticket), false);
    } finally { finishSend?.(); await dispose(f); }
  });

test('PostgreSQL unknown link delivery is not repeated and foreign recipients never receive a link',
  { skip: !databaseUrl }, async () => {
    const f = await fixture();
    try {
      await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','202')", [f.member.userId]);
      let sends = 0;
      const delivery = new JobLoginLinkDelivery({ sessions: f.service, repository: f.service.repository,
        origin: 'https://jarvis.example', send: async () => { sends++; throw new Error('synthetic lost acknowledgement'); } });
      const requestId = randomUUID();
      const first = await delivery.create({ userId: f.member.userId, requestId });
      assert.equal(first.telegramDelivery, 'unknown'); assert.ok(first.ticket);
      const replay = await delivery.create({ userId: f.member.userId, requestId });
      assert.equal(replay.telegramDelivery, 'unknown'); assert.equal(replay.ticket, first.ticket); assert.equal(sends, 1);
      const foreign = await delivery.create({ userId: f.adminMember.userId, requestId: randomUUID(), chatId: '202' });
      assert.equal(foreign.telegramDelivery, 'failed'); assert.equal(sends, 1);
      assert.ok(foreign.ticket); // A failed notification does not destroy the Mini App link.
    } finally { await dispose(f); }
  });

test('PostgreSQL link delivery rechecks jobs revision before sending and expires pending tickets without extension',
  { skip: !databaseUrl }, async () => {
    const f = await fixture();
    try {
      await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','202')", [f.member.userId]);
      let sends = 0;
      const originalClaim = f.service.repository.claimTelegramDelivery.bind(f.service.repository);
      f.service.repository.claimTelegramDelivery = async (args) => {
        const access = await f.accessService.getAccessForTelegram('202');
        await f.accessService.mutate(f.owner.userId, 'user.update', {
          operationId: randomUUID(), revision: access.revision, overrides: { jobs: 'deny' },
        }, '202');
        return originalClaim(args);
      };
      const delivery = new JobLoginLinkDelivery({ sessions: f.service, repository: f.service.repository,
        origin: 'https://jarvis.example', send: async () => { sends++; } });
      await assert.rejects(delivery.create({ userId: f.member.userId, requestId: randomUUID() }), { code: 'JOB_ACCESS_REVOKED' });
      assert.equal(sends, 0);
      const requestId = randomUUID();
      const initial = await f.service.create({ userId: f.adminMember.userId, requestId });
      await f.pool.query("UPDATE job_hh_login_sessions SET ticket_expires_at=now()-interval '1 second' WHERE id=$1", [initial.sessionId]);
      const expired = await f.service.create({ userId: f.adminMember.userId, requestId });
      assert.equal(expired.status, 'expired'); assert.equal(expired.ticket, null);
      const fresh = await f.service.create({ userId: f.adminMember.userId, requestId: randomUUID() });
      assert.notEqual(fresh.sessionId, initial.sessionId); assert.ok(fresh.ticket);
    } finally { await dispose(f); }
  });

test('real Telegram message and menu handlers deliver member HH links privately without history or replay',
  { skip: !databaseUrl }, async () => {
    const f = await fixture();
    try {
      const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
      const { JobTelegramService } = require('../src/jobs/jobTelegramService');
      const { TelegramMessageService } = require('../src/telegram/messageService');
      const { TelegramMenuService } = require('../src/telegram/telegramMenuService');
      const { TelegramUpdateRepository } = require('../src/telegram/telegramUpdateRepository');
      const { TelegramInteractionRepository } = require('../src/telegram/telegramInteractionRepository');
      const { UserRepository } = require('../src/users/userRepository');
      const { ConversationRepository } = require('../src/conversations/conversationRepository');
      const sends = [];
      const delivery = new JobLoginLinkDelivery({ sessions: f.service, repository: f.service.repository,
        origin: 'https://jarvis.example', send: async (message) => { sends.push(message); } });
      const interactions = new TelegramInteractionRepository(f.pool);
      const jobs = new JobTelegramService({ pool: f.pool, accessService: f.accessService, ownerTelegramId: '101',
        searchRepository: new JobSearchRepository(f.pool, { accessService: f.accessService }), loginLinkDelivery: delivery });
      const menu = new TelegramMenuService({ interactions, jobSearchService: jobs, accessService: f.accessService });
      const messages = new TelegramMessageService({ accessPolicy: { isAllowed: async () => true }, accessService: f.accessService,
        updateRepository: new TelegramUpdateRepository(f.pool), userRepository: new UserRepository(f.pool),
        conversationRepository: new ConversationRepository(f.pool), menuService: menu });
      const update = (id, chat = 202) => ({ update_id: id, callback_query: { id: String(id), from: { id: 202, first_name: 'Fixture' },
        data: 'job:connect', message: { message_id: id, chat: { id: chat, type: 'private' } } } });
      const first = await messages.handleCallback(update(100));
      assert.equal(first.status, 'answered'); assert.match(first.answer, /отправлена/);
      assert.equal(sends.length, 1); assert.equal(sends[0].chatId, '202');
      const url = sends[0].buttons[0][0].url;
      assert.ok(sends[0].answer.includes(url)); assert.equal(sends[0].disableLinkPreview, true);
      assert.equal((await messages.handleCallback(update(100))).status, 'duplicate');
      await messages.handleCallback(update(101)); assert.equal(sends.length, 1);
      await messages.handleCallback(update(102, 303)); assert.equal(sends.length, 1);
      const history = (await f.pool.query('SELECT content FROM messages WHERE user_id=$1', [f.member.userId])).rows;
      assert.ok(history.length); assert.equal(JSON.stringify(history).includes('#ticket='), false);
      const access = await f.accessService.getAccessForTelegram('202');
      await f.accessService.mutate(f.owner.userId, 'user.update', {
        operationId: randomUUID(), revision: access.revision, overrides: { jobs: 'deny' },
      }, '202');
      const revoked = await messages.handleCallback(update(103));
      assert.match(revoked.answer, /недоступен/); assert.equal(sends.length, 1);
    } finally { await dispose(f); }
  });
