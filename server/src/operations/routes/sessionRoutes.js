const { z } = require('zod');
const { FixedWindowRateLimiter } = require('../../http/rateLimiter');

const requestSchema = z.object({ label: z.string().trim().max(100).optional() }).strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();

function parseCookies(value) {
  const cookies = {};
  for (const part of String(value || '').split(';')) {
    const index = part.indexOf('='); if (index < 1) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { /* ignore malformed cookie */ }
  }
  return cookies;
}
function setCookie(reply, name, value, maxAge = null) {
  reply.header('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/ops; HttpOnly; Secure; SameSite=Strict${maxAge !== null ? `; Max-Age=${maxAge}` : ''}`);
}
function metadata(request) { return { userAgent: String(request.headers['user-agent'] || '').slice(0, 200) }; }
function registerSessionRoutes(app, { service, notifyApproval, requireSameOrigin, requireSession, onSessionRevoked = () => {} }) {
  const approvalLimiter = new FixedWindowRateLimiter();
  app.post('/ops/api/session/request', { preHandler: requireSameOrigin }, async (request, reply) => {
    approvalLimiter.check('owner-browser-approval', { limit: 3, windowMs: 60000 });
    const input = requestSchema.parse(request.body || {});
    const result = await service.request({ label: input.label || '', metadata: metadata(request) });
    setCookie(reply, 'jarvis_ops_request', result.verifier, 300);
    await notifyApproval(result.request, input.label || 'Новый браузер');
    reply.code(202); return { id: result.request.id, state: result.request.state, expiresAt: result.request.expires_at };
  });
  app.get('/ops/api/session/request/:id', async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const verifier = parseCookies(request.headers.cookie).jarvis_ops_request;
    if (!verifier) { reply.code(401); return { ok: false, code: 'REQUEST_VERIFIER_REQUIRED' }; }
    const result = await service.poll({ requestId: id, verifier, label: '', metadata: metadata(request) });
    if (result.state === 'approved') setCookie(reply, 'jarvis_ops_session', result.credential, 400 * 24 * 60 * 60);
    return { state: result.state };
  });
  app.post('/ops/api/session/logout', { preHandler: [requireSession, requireSameOrigin] }, async (request, reply) => {
    await service.revokeSession({ sessionId: request.panelSession.id, currentSessionId: request.panelSession.id });
    onSessionRevoked(request.panelSession.id);
    setCookie(reply, 'jarvis_ops_session', '', 0);
    return { ok: true };
  });
  app.get('/ops/api/sessions', { preHandler: requireSession }, async (request) => ({
    ok: true, sessions: await service.listSessions(request.panelSession.id),
  }));
  app.delete('/ops/api/sessions/:id', { preHandler: [requireSession, requireSameOrigin] }, async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const result = await service.revokeSession({ sessionId: id, currentSessionId: request.panelSession.id });
    if (!result.revoked) { reply.code(404); return { ok: false, code: 'PANEL_SESSION_NOT_FOUND' }; }
    onSessionRevoked(id);
    if (result.current) setCookie(reply, 'jarvis_ops_session', '', 0);
    return { ok: true, current: result.current };
  });
}
module.exports = { parseCookies, registerSessionRoutes, setCookie };
