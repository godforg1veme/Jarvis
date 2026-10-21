const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const Fastify = require('fastify');
const { registerMiniAppRoutes } = require('../src/miniApp/routes');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');

const origin = 'https://jarvis.example';
const botToken = 'fixture-job-login-bot-token';
function signed(telegramId) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Fixture' }) });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const data = [...fields].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, value]) => `${key}=${value}`).join('\n');
  fields.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return fields.toString();
}

function fixture() {
  const owner = { userId: randomUUID(), telegramId: '101', level: 'owner', blocked: false, permissions: ['jobs'] };
  const member = { userId: randomUUID(), telegramId: '202', level: 'member', blocked: false, permissions: ['jobs'] };
  const assistantOnly = { userId: randomUUID(), telegramId: '303', level: 'member', blocked: false, permissions: ['assistant'] };
  const actors = new Map([owner, member, assistantOnly].map((actor) => [actor.telegramId, actor]));
  const miniSessions = new Map();
  let guestToken = null, ticketClaimed = false, loginSessionId = randomUUID();
  const calls = [];
  const pool = {
    async query(sql, args = []) {
      if (sql.includes('INSERT INTO mini_app_sessions')) {
        miniSessions.set(args[0], { userId: args[2], csrfHash: args[1] });
        return { rows: [] };
      }
      if (sql.includes('DELETE FROM mini_app_sessions')) return { rows: [] };
      if (sql.includes('SELECT user_id,csrf_hash FROM mini_app_sessions')) {
        const session = miniSessions.get(args[0]); return { rows: session ? [{ user_id: session.userId, csrf_hash: session.csrfHash }] : [] };
      }
      if (sql.includes('SELECT status,resume_id,revision FROM job_connections')) return { rows: [] };
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
  const accessService = {
    async transaction(fn) { return fn(pool); },
    repository: { async get(_db, field, value) {
      return field === 'telegram' ? [...actors.values()].find((actor) => actor.telegramId === value) || null
        : [...actors.values()].find((actor) => actor.userId === value) || null;
    } },
    async getAccessForUser(userId) { return [...actors.values()].find((actor) => actor.userId === userId) || null; },
  };
  const service = {
    async create(input) { calls.push(['create', input]); return { sessionId: loginSessionId, ticket: 'a'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), status: 'pending' }; },
    async status(input) {
      calls.push(['status', input]);
      if (input.sessionId !== loginSessionId || input.userId !== member.userId) throw Object.assign(new Error('JOB_LOGIN_SESSION_INVALID'), { code: 'JOB_LOGIN_SESSION_INVALID' });
      return { status: 'claimed', state: 'waiting', resumes: [], nextSequence: 1 };
    },
    async claim({ ticket, existingGuestToken }) {
      if (ticket !== 'a'.repeat(64)) throw Object.assign(new Error('JOB_LOGIN_TICKET_INVALID'), { code: 'JOB_LOGIN_TICKET_INVALID' });
      if (ticketClaimed && existingGuestToken !== guestToken) throw Object.assign(new Error('JOB_LOGIN_TICKET_INVALID'), { code: 'JOB_LOGIN_TICKET_INVALID' });
      guestToken = 'b'.repeat(64);
      ticketClaimed = true;
      return { sessionId: loginSessionId, guestToken, expiresAt: new Date(Date.now() + 600000).toISOString() };
    },
    async authorizeGuest({ guestToken: candidate }) {
      if (!guestToken || candidate !== guestToken) throw Object.assign(new Error('JOB_LOGIN_SESSION_INVALID'), { code: 'JOB_LOGIN_SESSION_INVALID' });
      return { sessionId: loginSessionId, userId: member.userId };
    },
    async frame(input) { calls.push(['frame', input]); return { state: 'waiting', mimeType: 'image/jpeg', frameBase64: 'ZmFrZQ==', width: 1024, height: 768 }; },
    async input(input) { calls.push(['input', input]); return { state: 'waiting', nextSequence: input.sequence + 1 }; },
    async cancel(input) { calls.push(['cancel', input]); return { status: 'cancelled' }; },
    async confirm(input) { calls.push(['confirm', input]); return { status: 'connected', resumeId: input.resumeId }; },
  };
  const app = Fastify({ logger: false });
  registerMiniAppRoutes(app, { config: { miniAppPublicOrigin: origin, telegramBotToken: botToken }, accessService, pool,
    registerUserRoutes: (routes) => registerMiniAppSelfRoutes(routes, { accessService, pool,
      getJobConnectionSessionService: () => service, getJobLoginLinkDelivery: () => service }) });
  const miniLogin = async (telegramId) => {
    const response = await app.inject({ method: 'POST', url: '/mini/api/session', headers: { origin }, payload: { initData: signed(telegramId) } });
    return { statusCode: response.statusCode, cookie: response.headers['set-cookie'].split(';')[0], csrf: response.json().csrfToken };
  };
  return { app, owner, member, assistantOnly, calls, miniLogin, getSessionId: () => loginSessionId };
}

test('member Mini App session can create and poll only its own job login, then claim a one-time guest cookie', async () => {
  const f = fixture();
  try {
    const memberSession = await f.miniLogin('202');
    const created = await f.app.inject({ method: 'POST', url: '/mini/api/jobs/login', headers: { origin,
      cookie: memberSession.cookie, 'x-jarvis-csrf': memberSession.csrf }, payload: { requestId: randomUUID() } });
    assert.equal(created.statusCode, 200);
    assert.equal(f.calls.find(([name]) => name === 'create')[1].userId, f.member.userId);
    assert.match(created.headers['cache-control'], /no-store/);

    const owned = await f.app.inject({ method: 'GET', url: `/mini/api/jobs/login/owned/status/${f.getSessionId()}`, headers: { cookie: memberSession.cookie } });
    assert.equal(owned.statusCode, 200);
    assert.equal(owned.json().status, 'claimed');
    assert.equal(f.calls.find(([name]) => name === 'status')[1].userId, f.member.userId);

    const ownerSession = await f.miniLogin('101');
    const foreign = await f.app.inject({ method: 'GET', url: `/mini/api/jobs/login/owned/status/${f.getSessionId()}`, headers: { cookie: ownerSession.cookie } });
    assert.equal(foreign.statusCode, 401);
    assert.deepEqual(foreign.json(), { ok: false, code: 'JOB_LOGIN_SESSION_INVALID' });
    assert.equal(f.calls.at(-1)[1].userId, f.owner.userId);

    const claim = await f.app.inject({ method: 'POST', url: '/mini/api/jobs/login/claim', headers: { origin }, payload: { ticket: 'a'.repeat(64) } });
    assert.equal(claim.statusCode, 200);
    assert.equal(claim.json().guestToken, undefined);
    const guestCookie = claim.headers['set-cookie'];
    assert.match(guestCookie, /^__Secure-jarvis-job-login=b{64}; Path=\/mini\/api\/jobs\/login; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/);
    const cookie = guestCookie.split(';')[0];
    const replayWithoutCookie = await f.app.inject({ method: 'POST', url: '/mini/api/jobs/login/claim', headers: { origin }, payload: { ticket: 'a'.repeat(64) } });
    assert.equal(replayWithoutCookie.statusCode, 401);
    assert.equal(replayWithoutCookie.json().code, 'JOB_LOGIN_TICKET_INVALID');
    const sameBrowserRetry = await f.app.inject({ method: 'POST', url: '/mini/api/jobs/login/claim', headers: { origin, cookie }, payload: { ticket: 'a'.repeat(64) } });
    assert.equal(sameBrowserRetry.statusCode, 200);
    assert.equal(sameBrowserRetry.headers['set-cookie'], guestCookie);
    const frame = await f.app.inject({ url: `/mini/api/jobs/login/frame/${f.getSessionId()}`, headers: { cookie } });
    assert.equal(frame.statusCode, 200);
    assert.equal(frame.json().mimeType, 'image/jpeg');
    assert.equal(f.calls.find(([name]) => name === 'frame')[1].userId, f.member.userId);

    const denied = await f.app.inject({ method: 'POST', url: `/mini/api/jobs/login/input/${randomUUID()}`, headers: { origin, cookie }, payload: {
      sequence: 1, event: { type: 'text', value: 'fixture' },
    } });
    assert.equal(denied.statusCode, 401);
    assert.equal(f.calls.some(([name]) => name === 'input'), false);
    const wrongOrigin = await f.app.inject({ method: 'POST', url: `/mini/api/jobs/login/input/${f.getSessionId()}`,
      headers: { origin: 'https://attacker.example', cookie }, payload: { sequence: 1, event: { type: 'text', value: 'fixture' } } });
    assert.equal(wrongOrigin.statusCode, 403);
    assert.equal(wrongOrigin.json().code, 'invalid_origin');

    const input = await f.app.inject({ method: 'POST', url: `/mini/api/jobs/login/input/${f.getSessionId()}`,
      headers: { origin, cookie }, payload: { sequence: 1, event: { type: 'text', value: 'fixture' } } });
    assert.equal(input.statusCode, 200);
    assert.equal(input.json().nextSequence, 2);

    const noJobs = await f.miniLogin('303');
    const deniedCreate = await f.app.inject({ method: 'POST', url: '/mini/api/jobs/login', headers: { origin,
      cookie: noJobs.cookie, 'x-jarvis-csrf': noJobs.csrf }, payload: { requestId: randomUUID() } });
    assert.equal(deniedCreate.statusCode, 403);
    assert.equal(f.calls.filter(([name]) => name === 'create').length, 1);
  } finally { await f.app.close(); }
});
