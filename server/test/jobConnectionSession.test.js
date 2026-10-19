const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { JobConnectionSessionService, assertJobLoginAccess, digest } = require('../src/jobs/jobConnectionSessionService');

class MemoryRepository {
  constructor() { this.rows = new Map(); this.connections = new Map(); }
  async transaction(fn) { return fn({}); }
  async connected(_client, userId) { return this.connections.get(userId) || null; }
  async createOrRefresh(_client, input) {
    if (this.connections.get(input.userId)?.status === 'connected') return { status: 'connected', connected: true };
    let row = [...this.rows.values()].find((item) => item.user_id === input.userId
      && ['pending', 'claimed', 'authenticated'].includes(item.status));
    const expiredSessionIds = [];
    if (row) {
      row.ticket_hash = input.ticketHash; row.guest_token_hash = null;
      row.membership_revision = input.membershipRevision; row.role_id = input.roleId;
      row.role_revision = input.roleRevision; row.ticket_expires_at = input.ticketExpiresAt;
      return { ...row, ticketIssued: true, expiredSessionIds };
    }
    row = { id: randomUUID(), user_id: input.userId, request_id: input.requestId,
      ticket_hash: input.ticketHash, guest_token_hash: null, membership_revision: input.membershipRevision,
      role_id: input.roleId, role_revision: input.roleRevision, status: 'pending', resume_id: null,
      ticket_expires_at: input.ticketExpiresAt, expires_at: input.expiresAt };
    this.rows.set(row.id, row);
    return { ...row, ticketIssued: true, expiredSessionIds };
  }
  async byTicketForUpdate(_client, ticketHash) { return [...this.rows.values()].find((row) => row.ticket_hash === ticketHash) || null; }
  async claimLocked(_client, { id, guestTokenHash }) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending'
      || new Date(row.ticket_expires_at).getTime() <= Date.now() || new Date(row.expires_at).getTime() <= Date.now()
      || row.ticket_hash === null || row.guest_token_hash !== null) return null;
    row.guest_token_hash = guestTokenHash;
    row.status = 'claimed';
    return row;
  }
  async byGuestHash(_client, tokenHash) { return [...this.rows.values()].find((row) => row.guest_token_hash === tokenHash) || null; }
  async byIdForUser(_client, { sessionId, userId }) {
    const row = this.rows.get(sessionId);
    return row?.user_id === userId ? row : null;
  }
  async setStatus(_client, { sessionId, userId, status }) {
    const row = await this.byIdForUser(_client, { sessionId, userId });
    if (!row) return null;
    row.status = status;
    if (['confirmed', 'cancelled', 'expired', 'revoked', 'failed'].includes(status)) {
      row.ticket_hash = null; row.guest_token_hash = null;
    }
    return row;
  }
  async confirmLocked(_client, { sessionId, userId, resumeId }) {
    const row = await this.byIdForUser(_client, { sessionId, userId });
    if (!row || row.status !== 'authenticated') throw Object.assign(new Error('JOB_LOGIN_SESSION_INVALID'), { code: 'JOB_LOGIN_SESSION_INVALID' });
    const previous = this.connections.get(userId);
    const connection = { status: 'connected', resume_id: resumeId, revision: (previous?.revision || 0) + 1 };
    this.connections.set(userId, connection); row.resume_id = resumeId; row.status = 'confirmed';
    row.ticket_hash = null; row.guest_token_hash = null;
    return { row, connection };
  }
  async expireDue() {
    const now = Date.now();
    const expired = [];
    for (const row of this.rows.values()) {
      if (expired.length === 50) break;
      if (['pending', 'claimed', 'authenticated'].includes(row.status) && new Date(row.expires_at).getTime() <= now) {
        row.status = 'expired'; row.ticket_hash = null; row.guest_token_hash = null;
        expired.push({ id: row.id, user_id: row.user_id });
      }
    }
    return expired;
  }
}

function fixture() {
  const ownerId = randomUUID(), memberId = randomUUID(), otherId = randomUUID();
  const access = new Map([ownerId, memberId, otherId].map((userId, index) => [userId, {
    userId, blocked: false, permissions: ['jobs'], revision: 1, roleId: index ? 'role-jobs' : null, roleRevision: index ? 3 : 0,
  }]));
  const repository = new MemoryRepository();
  const calls = [];
  const browsers = new Map();
  const browserClient = { ownerId, forUser(userId) {
    if (!browsers.has(userId)) {
      const profile = { state: 'waiting', sessionId: null, selectedResume: null, discarded: [], closed: [],
        resumes: [{ id: userId === memberId ? 'memberResume' : 'otherResume', title: `Resume ${userId}` }] };
      const browser = {
        async startLogin({ sessionId }) { profile.sessionId = sessionId; calls.push(['startLogin', userId, sessionId]); return { ok: true }; },
        async loginStatus({ sessionId }) { if (profile.sessionId !== sessionId) throw Object.assign(new Error('JOB_LOGIN_SESSION_INVALID'), { code: 'JOB_LOGIN_SESSION_INVALID' }); return { state: profile.state, resumes: profile.state === 'authenticated' ? profile.resumes : [], nextSequence: 1 }; },
        async loginFrame({ sessionId }) { assert.equal(profile.sessionId, sessionId); return { state: 'waiting' }; },
        async loginInput({ sessionId }) { assert.equal(profile.sessionId, sessionId); return { state: 'waiting', nextSequence: 2 }; },
        async listResumes() { return profile.state === 'authenticated' ? profile.resumes : []; },
        async selectResume({ resumeId }) { profile.selectedResume = resumeId; return { ok: true }; },
        async closeLogin({ sessionId }) { profile.closed.push(sessionId); return { ok: true }; },
        async discardLogin({ sessionId }) { profile.discarded.push(sessionId); profile.sessionId = null; return { ok: true }; },
      };
      browsers.set(userId, { profile, browser });
    }
    return browsers.get(userId).browser;
  } };
  const service = new JobConnectionSessionService({ repository,
    accessService: { repository: { async get(_client, _field, userId) { return access.get(userId) || null; } } }, browserClient });
  return { ownerId, memberId, otherId, access, repository, browsers, calls, service };
}

test('login access requires the same user, current jobs permission, and unchanged membership and role revisions', () => {
  const current = { userId: randomUUID(), blocked: false, permissions: ['jobs'], revision: 4, roleId: 'role-a', roleRevision: 7 };
  const saved = { userId: current.userId, membershipRevision: 4, roleId: 'role-a', roleRevision: 7 };
  assert.equal(assertJobLoginAccess(saved, current), current);
  for (const changed of [
    { ...current, userId: randomUUID() }, { ...current, blocked: true },
    { ...current, permissions: ['assistant'] }, { ...current, revision: 5 },
    { ...current, roleId: 'role-b' }, { ...current, roleRevision: 8 }, null,
  ]) assert.throws(() => assertJobLoginAccess(saved, changed), { code: 'JOB_ACCESS_REVOKED' });
});

test('one-time ticket retry requires the claimed guest cookie and stores only token digests', async () => {
  const f = fixture();
  const created = await f.service.create({ userId: f.memberId, requestId: randomUUID() });
  assert.equal(Buffer.from(created.ticket, 'hex').length, 32);
  const row = f.repository.rows.get(created.sessionId);
  assert.equal(row.ticket_hash, digest(created.ticket));
  assert.notEqual(row.ticket_hash, created.ticket);
  const first = await f.service.claim({ ticket: created.ticket });
  await assert.rejects(f.service.claim({ ticket: created.ticket }), { code: 'JOB_LOGIN_TICKET_INVALID' });
  const retry = await f.service.claim({ ticket: created.ticket, existingGuestToken: first.guestToken });
  assert.deepEqual(retry, { ...first, replay: true });
  assert.equal(row.ticket_hash, digest(created.ticket));
  assert.equal(f.repository.rows.get(created.sessionId).guest_token_hash, digest(first.guestToken));
  assert.equal(f.repository.rows.get(created.sessionId).guest_token_hash.includes(first.guestToken), false);
  assert.equal(f.calls.every(([, userId]) => userId === f.memberId), true);
  await assert.rejects(f.service.loadOwned({ sessionId: created.sessionId, userId: f.otherId }), { code: 'JOB_LOGIN_SESSION_INVALID' });
  const denied = fixture(); denied.access.get(denied.memberId).permissions = ['assistant'];
  await assert.rejects(denied.service.create({ userId: denied.memberId, requestId: randomUUID() }), { code: 'JOB_ACCESS_REVOKED' });
});

test('authenticated member confirms only a resume from their own HH profile, idempotently', async () => {
  const f = fixture();
  const created = await f.service.create({ userId: f.memberId, requestId: randomUUID() });
  const claimed = await f.service.claim({ ticket: created.ticket });
  f.browsers.get(f.memberId).profile.state = 'authenticated';
  const status = await f.service.status({ sessionId: created.sessionId, userId: f.memberId });
  assert.equal(status.status, 'authenticated');
  assert.deepEqual(status.resumes.map(({ id }) => id), ['memberResume']);
  await assert.rejects(f.service.confirm({ sessionId: created.sessionId, userId: f.memberId, resumeId: 'otherResume' }), { code: 'JOB_LOGIN_RESUME_INVALID' });
  assert.deepEqual(await f.service.confirm({ sessionId: created.sessionId, userId: f.memberId, resumeId: 'memberResume' }),
    { status: 'connected', resumeId: 'memberResume' });
  assert.deepEqual(await f.service.confirm({ sessionId: created.sessionId, userId: f.memberId, resumeId: 'memberResume' }),
    { status: 'connected', resumeId: 'memberResume' });
  assert.deepEqual(f.repository.connections.get(f.memberId), { status: 'connected', resume_id: 'memberResume', revision: 1 });
  assert.equal(f.repository.connections.has(f.ownerId), false);
  assert.equal(f.repository.rows.get(created.sessionId).ticket_hash, null);
  assert.equal(f.repository.rows.get(created.sessionId).guest_token_hash, null);
  assert.equal(f.browsers.get(f.memberId).profile.selectedResume, 'memberResume');
  assert.equal(f.browsers.get(f.memberId).profile.closed.includes(claimed.sessionId), true);
});

test('revoked access and expired sessions close and discard only unconfirmed member profiles', async () => {
  const f = fixture();
  const created = await f.service.create({ userId: f.memberId, requestId: randomUUID() });
  const claimed = await f.service.claim({ ticket: created.ticket });
  f.access.get(f.memberId).permissions = ['assistant'];
  await assert.rejects(f.service.authorizeGuest({ guestToken: claimed.guestToken }), { code: 'JOB_LOGIN_SESSION_INVALID' });
  assert.equal(f.repository.rows.get(created.sessionId).status, 'revoked');
  assert.deepEqual(f.browsers.get(f.memberId).profile.discarded, [created.sessionId]);

  const expiring = await f.service.create({ userId: f.otherId, requestId: randomUUID() });
  await f.service.claim({ ticket: expiring.ticket });
  f.repository.rows.get(expiring.sessionId).expires_at = new Date(Date.now() - 1000);
  await f.service.sweepExpired();
  assert.equal(f.repository.rows.get(expiring.sessionId).status, 'expired');
  assert.deepEqual(f.browsers.get(f.otherId).profile.discarded, [expiring.sessionId]);
});
