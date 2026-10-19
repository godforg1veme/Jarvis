const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { z } = require('zod');
const { jobError } = require('./jobSchemas');

const TICKET_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 30 * 1000;
const TICKET_HEX = /^[a-f\d]{64}$/i;

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function guestTokenFor(ticket, sessionId) {
  return createHmac('sha256', Buffer.from(ticket, 'hex'))
    .update(`jarvis-job-login-guest\0${sessionId}`)
    .digest('hex');
}
function sameDigest(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !/^[a-f\d]{64}$/i.test(left) || !/^[a-f\d]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function assertJobLoginAccess(session, access) {
  if (!access || access.userId !== session.userId || access.blocked
    || !Array.isArray(access.permissions) || !access.permissions.includes('jobs')
    || access.revision !== session.membershipRevision
    || (access.roleId ?? null) !== (session.roleId ?? null)
    || access.roleRevision !== session.roleRevision) throw jobError('JOB_ACCESS_REVOKED');
  return access;
}

class JobConnectionSessionService {
  constructor({ repository, accessService, browserClient, now = Date.now }) {
    this.repository = repository;
    this.accessService = accessService;
    this.browserClient = browserClient;
    this.now = now;
    this.sweepTimer = null;
    this.sweepPromise = null;
  }

  start() {
    if (this.sweepTimer) return;
    void this.sweepExpired().catch(() => {});
    this.sweepTimer = setInterval(() => { void this.sweepExpired().catch(() => {}); }, SESSION_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  async stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    if (this.sweepPromise) await this.sweepPromise.catch(() => {});
  }

  async sweepExpired() {
    if (this.sweepPromise) return this.sweepPromise;
    this.sweepPromise = (async () => {
      const expired = await this.repository.expireDue();
      for (const session of expired) {
        await this.closeBrowserSession(session.user_id, session.id, { discardUnconfirmed: true });
      }
    })();
    try { await this.sweepPromise; }
    finally { this.sweepPromise = null; }
  }

  async accessFor(client, userId) {
    return this.accessService.repository.get(client, 'user', userId);
  }

  async closeBrowserSession(userId, sessionId, { discardUnconfirmed = false } = {}) {
    const browser = this.browserClient.forUser(userId);
    if (discardUnconfirmed && userId !== this.browserClient.ownerId) {
      try {
        const connection = await this.repository.transaction((client) => this.repository.connected(client, userId));
        if (!connection) { await browser.discardLogin({ sessionId }); return; }
      } catch { /* Preserve the profile if its connection status cannot be confirmed. */ }
    }
    try { await browser.closeLogin({ sessionId }); } catch { /* The browser may have expired or restarted. */ }
  }

  async failUnconfirmedLogin(userId, sessionId) {
    await this.repository.transaction(async (client) => {
      const current = await this.repository.byIdForUser(client, { sessionId, userId });
      if (current && ['pending','claimed','authenticated'].includes(current.status))
        await this.repository.setStatus(client, { sessionId, userId, status: 'failed' });
    });
    await this.closeBrowserSession(userId, sessionId, { discardUnconfirmed: true });
    throw jobError('JOB_LOGIN_SESSION_INVALID');
  }

  async listAuthenticatedResumes(browser, userId, sessionId) {
    try { return await browser.listResumes(); }
    catch (error) {
      if (['JOB_HH_LOGIN_REQUIRED','JOB_HH_ACCESS_DENIED'].includes(error.code))
        await this.failUnconfirmedLogin(userId, sessionId);
      throw error;
    }
  }

  async create({ userId, requestId }) {
    userId = z.uuid().parse(userId);
    requestId = z.uuid().parse(requestId);
    const rawTicket = randomBytes(32).toString('hex');
    const ticketExpiresAt = new Date(this.now() + TICKET_TTL_MS);
    const expiresAt = new Date(this.now() + SESSION_TTL_MS);
    const result = await this.repository.transaction(async (client) => {
      const access = await this.accessFor(client, userId);
      if (!access || access.blocked || !access.permissions.includes('jobs')) throw jobError('JOB_ACCESS_REVOKED');
      return this.repository.createOrRefresh(client, {
        userId, requestId, ticketHash: digest(rawTicket), membershipRevision: access.revision,
        roleId: access.roleId ?? null, roleRevision: access.roleRevision,
        ticketExpiresAt, expiresAt, now: new Date(this.now()),
      });
    });
    for (const expiredSessionId of result.expiredSessionIds || [])
      await this.closeBrowserSession(userId, expiredSessionId, { discardUnconfirmed: true });
    if (result.connected) return { sessionId: null, ticket: null, expiresAt: null, status: 'connected' };
    return { sessionId: result.id, ticket: result.ticketIssued ? rawTicket : null,
      expiresAt: new Date(result.expires_at).toISOString(), status: result.status };
  }

  async claim({ ticket, existingGuestToken = null }) {
    if (typeof ticket !== 'string' || !TICKET_HEX.test(ticket)) throw jobError('JOB_LOGIN_TICKET_INVALID');
    const ticketHash = digest(ticket);
    const claimed = await this.repository.transaction(async (client) => {
      const row = await this.repository.byTicketForUpdate(client, ticketHash);
      if (!row || !['pending', 'claimed', 'authenticated'].includes(row.status)
        || new Date(row.ticket_expires_at).getTime() <= this.now()
        || new Date(row.expires_at).getTime() <= this.now()) throw jobError('JOB_LOGIN_TICKET_INVALID');
      try { assertJobLoginAccess({ userId: row.user_id, membershipRevision: row.membership_revision,
        roleId: row.role_id, roleRevision: row.role_revision }, await this.accessFor(client, row.user_id)); }
      catch { await this.repository.setStatus(client, { sessionId: row.id, userId: row.user_id, status: 'revoked' }); return { revoked: true, userId: row.user_id, sessionId: row.id }; }
      const guestToken = guestTokenFor(ticket, row.id);
      const guestTokenHash = digest(guestToken);
      if (row.status !== 'pending') {
        if (!sameDigest(row.guest_token_hash, digest(existingGuestToken || ''))
          || !sameDigest(row.guest_token_hash, guestTokenHash)) throw jobError('JOB_LOGIN_TICKET_INVALID');
        return { sessionId: row.id, userId: row.user_id, status: row.status, guestToken,
          expiresAt: new Date(row.expires_at).toISOString(), replay: true };
      }
      const saved = await this.repository.claimLocked(client, { id: row.id, guestTokenHash });
      if (!saved || !sameDigest(saved.guest_token_hash, guestTokenHash)) throw jobError('JOB_LOGIN_TICKET_INVALID');
      return { sessionId: saved.id, userId: saved.user_id, status: saved.status, guestToken,
        expiresAt: new Date(saved.expires_at).toISOString() };
    });
    if (!claimed || claimed.revoked) {
      if (claimed?.revoked) await this.closeBrowserSession(claimed.userId, claimed.sessionId, { discardUnconfirmed: true });
      throw jobError('JOB_LOGIN_TICKET_INVALID');
    }
    try {
      if (!claimed.replay && claimed.status !== 'authenticated') await this.browserClient.forUser(claimed.userId).startLogin({ sessionId: claimed.sessionId });
    }
    catch (error) {
      await this.repository.transaction(async (client) => {
        await this.repository.setStatus(client, { sessionId: claimed.sessionId, userId: claimed.userId, status: 'failed' });
      });
      await this.closeBrowserSession(claimed.userId, claimed.sessionId, { discardUnconfirmed: true });
      throw error;
    }
    return { sessionId: claimed.sessionId, guestToken: claimed.guestToken, expiresAt: claimed.expiresAt,
      replay: Boolean(claimed.replay) };
  }

  async authorizeGuest({ guestToken }) {
    if (typeof guestToken !== 'string' || !TICKET_HEX.test(guestToken)) throw jobError('JOB_LOGIN_SESSION_INVALID');
    const guestTokenHash = digest(guestToken);
    const result = await this.repository.transaction(async (client) => {
      const row = await this.repository.byGuestHash(client, guestTokenHash);
      if (!row || !['claimed','authenticated'].includes(row.status)) throw jobError('JOB_LOGIN_SESSION_INVALID');
      if (new Date(row.expires_at).getTime() <= this.now()) {
        await this.repository.setStatus(client, { sessionId: row.id, userId: row.user_id, status: 'expired' });
        return { closed: true, userId: row.user_id, sessionId: row.id };
      }
      try { assertJobLoginAccess({ userId: row.user_id, membershipRevision: row.membership_revision,
        roleId: row.role_id, roleRevision: row.role_revision }, await this.accessFor(client, row.user_id)); }
      catch { await this.repository.setStatus(client, { sessionId: row.id, userId: row.user_id, status: 'revoked' }); return { closed: true, userId: row.user_id, sessionId: row.id }; }
      return { sessionId: row.id, userId: row.user_id };
    });
    if (result.closed) { await this.closeBrowserSession(result.userId, result.sessionId, { discardUnconfirmed: true }); throw jobError('JOB_LOGIN_SESSION_INVALID'); }
    return result;
  }

  async loadOwned({ sessionId, userId }) {
    sessionId = z.uuid().parse(sessionId);
    userId = z.uuid().parse(userId);
    const result = await this.repository.transaction(async (client) => {
      const row = await this.repository.byIdForUser(client, { sessionId, userId });
      if (!row) throw jobError('JOB_LOGIN_SESSION_INVALID');
      try { assertJobLoginAccess({ userId: row.user_id, membershipRevision: row.membership_revision,
        roleId: row.role_id, roleRevision: row.role_revision }, await this.accessFor(client, userId)); }
      catch { await this.repository.setStatus(client, { sessionId, userId, status: 'revoked' }); return { error: 'JOB_ACCESS_REVOKED', close: true, row }; }
      if (['pending','claimed','authenticated'].includes(row.status) && new Date(row.expires_at).getTime() <= this.now()) {
        await this.repository.setStatus(client, { sessionId, userId, status: 'expired' });
        return { error: 'JOB_LOGIN_SESSION_EXPIRED', close: true, row };
      }
      return { row };
    });
    if (result.error) {
      if (result.close) await this.closeBrowserSession(userId, sessionId, { discardUnconfirmed: true });
      throw jobError(result.error);
    }
    return result.row;
  }

  async updateAuthenticated(row, userId) {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.byIdForUser(client, { sessionId: row.id, userId });
      if (!current || current.status !== 'claimed') return current;
      try { assertJobLoginAccess({ userId: current.user_id, membershipRevision: current.membership_revision,
        roleId: current.role_id, roleRevision: current.role_revision }, await this.accessFor(client, userId)); }
      catch { await this.repository.setStatus(client, { sessionId: row.id, userId, status: 'revoked' }); return null; }
      return this.repository.setStatus(client, { sessionId: row.id, userId, status: 'authenticated' });
    });
  }

  async status({ sessionId, userId }) {
    const row = await this.loadOwned({ sessionId, userId });
    const browser = this.browserClient.forUser(userId);
    if (row.status === 'authenticated') {
      const resumes = await this.listAuthenticatedResumes(browser, userId, row.id);
      return { status: 'authenticated', state: 'authenticated', resumes, nextSequence: 1 };
    }
    if (row.status === 'claimed') {
      let state;
      try { state = await browser.loginStatus({ sessionId: row.id }); }
      catch (error) {
        if (error.code !== 'JOB_LOGIN_SESSION_INVALID') throw error;
        const resumes = await this.listAuthenticatedResumes(browser, userId, row.id);
        const updated = await this.updateAuthenticated(row, userId);
        if (!updated) { await this.closeBrowserSession(userId, row.id, { discardUnconfirmed: true }); throw jobError('JOB_ACCESS_REVOKED'); }
        await browser.closeLogin({ sessionId: row.id, preserveProfile: true }).catch(() => {});
        await this.loadOwned({ sessionId, userId });
        return { status: 'authenticated', state: 'authenticated', resumes, nextSequence: 1 };
      }
      if (['expired', 'closed'].includes(state.state)) await this.failUnconfirmedLogin(userId, row.id);
      if (state.state === 'authenticated') {
        const updated = await this.updateAuthenticated(row, userId);
        if (!updated) { await this.closeBrowserSession(userId, row.id, { discardUnconfirmed: true }); throw jobError('JOB_ACCESS_REVOKED'); }
        await browser.closeLogin({ sessionId: row.id, preserveProfile: true });
      }
      const current = await this.loadOwned({ sessionId, userId });
      return { status: current.status, state: state.state, resumes: current.status === 'authenticated' ? state.resumes : [], nextSequence: state.nextSequence };
    }
    return { status: row.status, state: row.status, resumes: [], nextSequence: 1 };
  }

  async frame({ sessionId, userId }) {
    const row = await this.loadOwned({ sessionId, userId });
    if (row.status !== 'claimed') throw jobError('JOB_LOGIN_SESSION_INVALID');
    return this.browserClient.forUser(userId).loginFrame({ sessionId: row.id });
  }

  async input({ sessionId, userId, sequence, event }) {
    const row = await this.loadOwned({ sessionId, userId });
    if (row.status !== 'claimed') throw jobError('JOB_LOGIN_SESSION_INVALID');
    return this.browserClient.forUser(userId).loginInput({ sessionId: row.id, sequence, event });
  }

  async confirm({ sessionId, userId, resumeId }) {
    if (typeof resumeId !== 'string' || !/^[a-zA-Z0-9]{1,100}$/.test(resumeId)) throw jobError('JOB_LOGIN_RESUME_INVALID');
    const row = await this.loadOwned({ sessionId, userId });
    if (row.status === 'confirmed') {
      await this.browserClient.forUser(userId).closeLogin({ sessionId: row.id, preserveProfile: true, complete: true }).catch(() => {});
      return { status: 'connected', resumeId: row.resume_id };
    }
    if (row.status !== 'authenticated') throw jobError('JOB_LOGIN_SESSION_INVALID');
    const browser = this.browserClient.forUser(userId);
    const resumes = await this.listAuthenticatedResumes(browser, userId, row.id);
    const selected = resumes.find((resume) => resume.id === resumeId);
    if (!selected) throw jobError('JOB_LOGIN_RESUME_INVALID');
    await browser.selectResume({ resumeId });
    const verified = await this.listAuthenticatedResumes(browser, userId, row.id);
    if (!verified.some((resume) => resume.id === resumeId)) throw jobError('JOB_LOGIN_RESUME_INVALID');
    const confirmed = await this.repository.transaction(async (client) => {
      const current = await this.repository.byIdForUser(client, { sessionId: row.id, userId });
      if (!current || current.status !== 'authenticated' || new Date(current.expires_at).getTime() <= this.now()) throw jobError('JOB_LOGIN_SESSION_INVALID');
      try { assertJobLoginAccess({ userId: current.user_id, membershipRevision: current.membership_revision,
        roleId: current.role_id, roleRevision: current.role_revision }, await this.accessFor(client, userId)); }
      catch { await this.repository.setStatus(client, { sessionId: row.id, userId, status: 'revoked' }); return false; }
      await this.repository.confirmLocked(client, { sessionId: row.id, userId, resumeId });
      return true;
    });
    if (!confirmed) { await this.closeBrowserSession(userId, row.id, { discardUnconfirmed: true }); throw jobError('JOB_ACCESS_REVOKED'); }
    await browser.closeLogin({ sessionId: row.id, preserveProfile: true, complete: true }).catch(() => {});
    return { status: 'connected', resumeId };
  }

  async cancel({ sessionId, userId }) {
    const row = await this.loadOwned({ sessionId, userId });
    const outcome = await this.repository.transaction(async (client) => {
      const current = await this.repository.byIdForUser(client, { sessionId: row.id, userId });
      if (!current) throw jobError('JOB_LOGIN_SESSION_INVALID');
      if (current.status === 'confirmed') return { status: 'connected', resumeId: current.resume_id, close: false };
      try { assertJobLoginAccess({ userId: current.user_id, membershipRevision: current.membership_revision,
        roleId: current.role_id, roleRevision: current.role_revision }, await this.accessFor(client, userId)); }
      catch { await this.repository.setStatus(client, { sessionId: row.id, userId, status: 'revoked' }); return { revoked: true, close: true }; }
      if (!['cancelled', 'expired', 'revoked', 'failed'].includes(current.status)) {
        await this.repository.setStatus(client, { sessionId: row.id, userId, status: 'cancelled' });
      }
      return { status: 'cancelled', close: true };
    });
    if (outcome.close) await this.closeBrowserSession(userId, row.id, { discardUnconfirmed: true });
    if (outcome.revoked) throw jobError('JOB_ACCESS_REVOKED');
    return { status: outcome.status, ...(outcome.resumeId ? { resumeId: outcome.resumeId } : {}) };
  }
}

module.exports = { JobConnectionSessionService, assertJobLoginAccess, guestTokenFor, digest };
