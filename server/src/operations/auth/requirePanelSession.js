const { credentialHash } = require('../sessions/sessionCredentials');
const { parseCookies } = require('../routes/sessionRoutes');
function requirePanelSession(repository) {
  return async (request, reply) => {
    const token = parseCookies(request.headers.cookie).jarvis_ops_session;
    const session = token && token.length <= 512 ? await repository.findActiveSession(credentialHash(token)) : null;
    if (!session) { reply.code(401); return reply.send({ ok: false, code: 'PANEL_SESSION_REQUIRED' }); }
    request.panelSession = session;
  };
}
function requireOperationsHost(origin) {
  const expectedHost = new URL(origin).host.toLowerCase();
  return async (request, reply) => {
    if (!request.raw.url || !request.raw.url.startsWith('/ops')) return;
    if (String(request.headers.host || '').toLowerCase() !== expectedHost) {
      reply.code(404); return reply.send({ ok: false, code: 'OPERATIONS_HOST_REQUIRED' });
    }
  };
}
function requireSameOrigin(origin) {
  return async (request, reply) => {
    const requestOrigin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    // The approval endpoint has side effects (a Telegram message). Browsers
    // send Origin for POST; requiring it closes the no-Origin CSRF bypass.
    if (requestOrigin !== origin || (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite))) {
      reply.code(403); return reply.send({ ok: false, code: 'CROSS_ORIGIN_REJECTED' });
    }
  };
}
module.exports = { requireOperationsHost, requirePanelSession, requireSameOrigin };
