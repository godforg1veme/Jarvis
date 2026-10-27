const { z } = require('zod');
const { validateInitData } = require('./initData');
const {
  SessionService,
  sessionCookie,
  readToken,
} = require('./sessionService');
const { catalog } = require('../access/permissionCatalog');
const { accessError } = require('../access/accessPolicy');
const PUBLIC_CODES = new Set([
  'invalid_request',
  'invalid_login',
  'expired_login',
  'forbidden',
  'protected_owner',
  'already_exists',
  'not_found',
  'revision_conflict',
  'operation_conflict',
  'operation_unknown',
  'invalid_role',
  'unauthorized',
  'invalid_csrf',
  'invalid_origin',
  'rate_limited',
  'limit_reached',
  'JOB_ACCESS_REVOKED',
  'JOB_LOGIN_SESSION_INVALID',
  'JOB_LOGIN_TICKET_INVALID',
  'JOB_LOGIN_SESSION_EXPIRED',
  'JOB_LOGIN_ALREADY_ACTIVE',
  'JOB_LOGIN_RESUME_INVALID',
  'JOB_LOGIN_UNAVAILABLE',
  'JOB_BROWSER_BUSY',
  'JOB_RESUME_UNAVAILABLE','JOB_RESUME_RAISE_UNAVAILABLE','JOB_HH_NOT_CONNECTED','JOB_LOGIN_RESUME_INVALID',
]);
function publicError(error, reply) {
  const code = PUBLIC_CODES.has(error?.code) ? error.code : 'unavailable';
  const status =
    code === 'unauthorized'
      ? 401
      : ['JOB_LOGIN_SESSION_INVALID','JOB_LOGIN_TICKET_INVALID','JOB_LOGIN_SESSION_EXPIRED'].includes(code)
        ? 401
      : [
            'forbidden',
            'protected_owner',
            'invalid_csrf',
            'invalid_origin',
            'JOB_ACCESS_REVOKED',
          ].includes(code)
        ? 403
        : code === 'not_found' || code === 'operation_unknown'
          ? 404
          : code.includes('conflict') || code === 'already_exists' || code === 'JOB_LOGIN_ALREADY_ACTIVE'
            ? 409
            : code === 'rate_limited' || code === 'JOB_BROWSER_BUSY'
              ? 429
              : code === 'unavailable' || code === 'JOB_LOGIN_UNAVAILABLE'
                ? 503
                : 400;
  return reply.code(status).send({ ok: false, code });
}
function registerMiniAppRoutes(
  app,
  { config, accessService, pool, registerUserRoutes },
) {
  const sessions = new SessionService({ pool, accessService }),
    rates = new Map();
  function requireOrigin(request) {
    if (request.headers.origin !== config.miniAppPublicOrigin)
      throw accessError('invalid_origin');
  }
  function rate(request) {
    const key = request.ip,
      now = Date.now(),
      old = rates.get(key);
    if (!old || old.until < now) {
      if (rates.size >= 10000) {
        for (const [k, v] of rates) if (v.until < now) rates.delete(k);
        if (rates.size >= 10000) throw accessError('rate_limited');
      }
      rates.set(key, { until: now + 60000, count: 1 });
    } else if (++old.count > 120) throw accessError('rate_limited');
  }
  const wrap = (fn) => async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      rate(request);
      if (Object.keys(request.query || {}).length)
        throw accessError('invalid_request');
      return await fn(request, reply);
    } catch (e) {
      return publicError(e, reply);
    }
  };
  async function authorize(request, { mutation = false } = {}) {
    if (mutation) requireOrigin(request);
    const session = await sessions.requireSession(request);
    if (mutation) sessions.requireCsrf(request, session);
    return session;
  }
  const route = (method, url, fn, options = {}) => {
    if (options.binary) {
      app.register(async (scoped) => {
        const uploads = new Map(); let activeUploads = 0;
        const releaseUpload = (request) => {
          const userId = request.miniUploadUser;
          if (!userId) return;
          request.miniUploadUser = null; activeUploads--;
          const next = (uploads.get(userId) || 1) - 1;
          if (next) uploads.set(userId, next); else uploads.delete(userId);
        };
        scoped.addHook('onResponse', async (request) => releaseUpload(request));
        scoped.addHook('onError', async (request) => releaseUpload(request));
        scoped.addHook('onRequestAbort', async (request) => releaseUpload(request));
        if (scoped.hasContentTypeParser('application/octet-stream')) scoped.removeContentTypeParser('application/octet-stream');
        scoped.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: options.bodyLimit },
          (_request, body, done) => done(null, body));
        scoped.route({ method, url: `/mini/api${url}`, bodyLimit: options.bodyLimit,
          onRequest: async (request, reply) => {
            // Authenticate before Fastify buffers file bytes.
            try {
              rate(request);
              const session = await authorize(request, { mutation: true });
              if (!session.actor.permissions.includes('documents')) throw accessError('forbidden');
              if (request.headers['content-type'] !== 'application/octet-stream') throw accessError('invalid_request');
              if (activeUploads >= 4 || (uploads.get(session.actor.userId) || 0) >= 2) throw accessError('rate_limited');
              request.miniUploadUser = session.actor.userId;
              activeUploads++; uploads.set(session.actor.userId, (uploads.get(session.actor.userId) || 0) + 1);
            } catch (error) { return publicError(error, reply); }
          }, handler: wrap(fn) });
      });
      return;
    }
    app.route({
      method,
      url: `/mini/api${url}`,
      bodyLimit: 12288,
      handler: wrap(fn),
    });
  };
  route('POST', '/session', async (req, reply) => {
    requireOrigin(req);
    const parsed = z
      .strictObject({ initData: z.string().min(1).max(8192) })
      .safeParse(req.body);
    if (!parsed.success) throw accessError('invalid_request');
    const identity = validateInitData(
      parsed.data.initData,
      config.telegramBotToken,
    );
    const session = await sessions.create(identity.telegramId);
    const previous = readToken(req);
    if (previous) await sessions.revoke(previous);
    reply.header('Set-Cookie', sessionCookie(session.token));
    return {
      ok: true,
      csrfToken: session.csrfToken,
      actor: session.actor,
      catalog,
    };
  });
  route('GET', '/me', async (req) => {
    const s = await authorize(req);
    return { ok: true, csrfToken: s.csrfToken, actor: s.actor, catalog };
  });
  route('POST', '/logout', async (req, reply) => {
    if (req.body !== undefined && (!req.body || Object.keys(req.body).length))
      throw accessError('invalid_request');
    const s = await authorize(req, { mutation: true });
    await sessions.revoke(s.token);
    reply.header('Set-Cookie', sessionCookie(''));
    return { ok: true };
  });
  route('GET', '/admin', async (req) => {
    const s = await authorize(req);
    return { ok: true, ...(await accessService.listAdmin(s.actor.userId)) };
  });
  for (const [method, url, kind, param] of [
    ['POST', '/admin/users', 'user.create'],
    ['PATCH', '/admin/users/:telegramId', 'user.update', 'telegramId'],
    ['POST', '/admin/roles', 'role.create'],
    ['PATCH', '/admin/roles/:id', 'role.update', 'id'],
  ])
    route(method, url, async (req) => {
      const s = await authorize(req, { mutation: true });
      return {
        ok: true,
        result: await accessService.mutate(
          s.actor.userId,
          kind,
          req.body,
          param ? req.params[param] : null,
        ),
      };
    });
  route('GET', '/admin/operations/:id', async (req) => {
    const s = await authorize(req);
    return {
      ok: true,
      result: await accessService.getOperation(s.actor.userId, req.params.id),
    };
  });
  if (registerUserRoutes) registerUserRoutes({ route, authorize, requireOrigin, publicOrigin: config.miniAppPublicOrigin });
  return { sessions, authorize, route };
}
module.exports = { registerMiniAppRoutes, publicError };
