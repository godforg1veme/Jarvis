const { createHash } = require('node:crypto');
const { accessError } = require('../access/accessPolicy');
const { readBearerToken } = require('../devices/deviceAuth');
const { deviceTokenHash } = require('../devices/deviceCredentials');
const { registerMiniAppSelfRoutes } = require('../miniAppSelfRoutes');

const PREFIX = '/v1/desktop/workspace';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const RESUME_PRECLAIM_PATHS = new Set(['/jobs/resumes/refresh', '/jobs/resumes/settings']);
const RESUME_PRECLAIM_CODES = new Set(['invalid_request', 'revision_conflict',
  'JOB_REVISION_CONFLICT', 'JOB_HH_NOT_CONNECTED']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ROUTES = new Set([
  'GET /sections/:permission', 'GET /sections/:permission/page/:cursor',
  'GET /sections/:section/actions', 'GET /sections/:section/actions/:kind/:targetId',
  'POST /sections/:section/operations', 'GET /sections/:section/operations/:operationId',
  'POST /sections/:section/operations/:operationId/cancel',
  'POST /sections/documents/uploads/:operationId',
  'POST /memory/operations', 'GET /memory/operations/:id', 'POST /memory/operations/:id/cancel',
  'GET /assistant/messages', 'GET /assistant/messages/page/:cursor',
  'GET /jobs/automation', 'POST /jobs/automation',
  'GET /jobs/connection', 'GET /jobs/resumes', 'POST /jobs/resumes/refresh',
  'POST /jobs/resumes/settings', 'GET /jobs/resumes/operations/:requestId',
  'GET /jobs/resumes/operations/:requestId/inspection',
  'POST /jobs/resumes/operations/:requestId/confirm-inspection',
  'POST /jobs/login', 'GET /jobs/login/owned/status/:sessionId',
  'POST /jobs/login/confirm', 'POST /jobs/login/cancel',
]);

function publicFailure(error, reply, details = {}) {
  const code = error?.publicCode || error?.code;
  const allowed = new Set([
    'DEVICE_AUTH_REQUIRED', 'unauthorized', 'forbidden', 'invalid_request', 'revision_conflict',
    'operation_conflict', 'operation_unknown', 'rate_limited', 'limit_reached', 'unavailable',
    'JOB_ACCESS_REVOKED', 'JOB_AUTOMATION_UNAVAILABLE', 'JOB_REVISION_CONFLICT',
    'JOB_SCOPE_DENIED', 'JOB_RESUME_UNAVAILABLE', 'JOB_RESUME_RAISE_UNAVAILABLE',
    'JOB_HH_NOT_CONNECTED', 'JOB_LOGIN_UNAVAILABLE', 'JOB_BROWSER_BUSY',
    'JOB_LOGIN_SESSION_INVALID', 'JOB_LOGIN_SESSION_EXPIRED', 'JOB_LOGIN_ALREADY_ACTIVE',
    'JOB_LOGIN_RESUME_INVALID',
  ]);
  const safeCode = allowed.has(code) ? code : 'unavailable';
  const status = ['DEVICE_AUTH_REQUIRED', 'unauthorized', 'JOB_LOGIN_SESSION_INVALID',
    'JOB_LOGIN_SESSION_EXPIRED'].includes(safeCode) ? 401
    : ['forbidden', 'JOB_ACCESS_REVOKED', 'JOB_SCOPE_DENIED'].includes(safeCode) ? 403
      : safeCode === 'operation_unknown' ? 404
        : ['revision_conflict', 'operation_conflict', 'JOB_REVISION_CONFLICT',
          'JOB_LOGIN_ALREADY_ACTIVE'].includes(safeCode) ? 409
          : ['rate_limited', 'JOB_BROWSER_BUSY'].includes(safeCode) ? 429
            : ['unavailable', 'JOB_AUTOMATION_UNAVAILABLE', 'JOB_LOGIN_UNAVAILABLE'].includes(safeCode) ? 503 : 400;
  return reply.code(status).send({ ok: false, code: safeCode, ...details });
}

function actionSessionVerifier(db, session, actor) {
  if (!session || !actor || session.actor.userId !== actor.userId || !session.deviceId
    || !Buffer.isBuffer(session.deviceTokenHash) || session.deviceTokenHash.length !== 32)
    throw accessError('unauthorized');
  return db.query(`SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND token_hash=$3
    AND status<>'revoked' FOR SHARE`, [session.deviceId, actor.userId, session.deviceTokenHash])
    .then((row) => {
      if (!row.rowCount) throw accessError('unauthorized');
      // Receipts still use the shared per-user operation ID. Their session hash
      // must not be a Mini App cookie hash or contain the raw device credential.
      return createHash('sha256').update(`desktop-workspace:${session.deviceId}:${session.deviceTokenHash.toString('hex')}`).digest('hex');
    });
}

function registerDesktopWorkspaceRoutes(app, { authenticate, accessService, sectionReader,
  conversationRepository, documentUploadMaxBytes, ...services }) {
  if (!accessService) return;
  const maxUploadBytes = Math.min(Number(documentUploadMaxBytes) || 10 * 1024 * 1024, MAX_UPLOAD_BYTES);
  // The isolated parser retains the Mini App's upload bound; no credentials or
  // body bytes are read until the device and its current rights are checked.
  app.register(async (scoped) => {
    if (scoped.hasContentTypeParser('application/octet-stream')) scoped.removeContentTypeParser('application/octet-stream');
    scoped.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maxUploadBytes },
      (_request, body, done) => done(null, body));

    const requireWorkspace = async (request, permission = null) => {
      const device = await authenticate(request.headers);
      const actor = await accessService.getAccessForUser(device.user_id);
      if (!actor || actor.blocked || (permission && !actor.permissions.includes(permission))) throw accessError('forbidden');
      return { actor, deviceId: device.id, deviceTokenHash: deviceTokenHash(readBearerToken(request.headers)) };
    };
    const authorize = async (request) => {
      const fresh = await requireWorkspace(request);
      if (fresh.actor.userId !== request.workspaceSession?.actor.userId
        || fresh.deviceId !== request.workspaceSession?.deviceId) throw accessError('unauthorized');
      return fresh;
    };
    const proveResumeNotStarted = async (request, method, suffix, error) => {
      if (method !== 'POST' || !RESUME_PRECLAIM_PATHS.has(suffix)
        || !RESUME_PRECLAIM_CODES.has(error?.publicCode || error?.code)
        || !UUID.test(request.body?.requestId || '') || !services.pool?.query) return false;
      try {
        const fresh = await authorize(request);
        if (!fresh.actor.permissions.includes('jobs')) return false;
        const originalUserId = request.workspaceSession.actor.userId;
        const receipt = await services.pool.query(`SELECT 1 FROM job_resume_operations
          WHERE user_id=$1 AND request_id=$2 LIMIT 1`, [originalUserId, request.body.requestId]);
        if (receipt.rowCount !== 0) return false;
        const after = await authorize(request);
        return after.actor.permissions.includes('jobs');
      } catch (_) { return false; }
    };
    const route = (method, suffix, handler, options = {}) => {
      if (!ROUTES.has(`${method} ${suffix}`)) return;
      const binary = options.binary === true;
      scoped.route({ method, url: PREFIX + suffix, bodyLimit: binary ? maxUploadBytes : 12288,
        onRequest: async (request, reply) => {
          try {
            request.workspaceSession = await requireWorkspace(request,
              binary ? 'documents' : null);
          } catch (error) { return publicFailure(error, reply); }
        },
        handler: async (request, reply) => {
          reply.header('Cache-Control', 'no-store');
          try {
            if (Object.keys(request.query || {}).length) throw accessError('invalid_request');
            const result = await handler(request, reply);
            await authorize(request); // Revocation during a read must hide the result.
            return result;
          } catch (error) {
            const notStarted = await proveResumeNotStarted(request, method, suffix, error);
            return publicFailure(error, reply, notStarted ? { notStarted: true } : {});
          }
        } });
    };
    const direct = (suffix, permission, handler) => scoped.get(PREFIX + suffix, {
      onRequest: async (request, reply) => {
        try { request.workspaceSession = await requireWorkspace(request, permission); }
        catch (error) { return publicFailure(error, reply); }
      },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        if (Object.keys(request.query || {}).length) throw accessError('invalid_request');
        const result = await handler(request);
        const fresh = await authorize(request);
        if (permission && !fresh.actor.permissions.includes(permission)) throw accessError('forbidden');
        if (suffix === '/me') {
          const { userId, telegramId, level, permissions } = fresh.actor;
          return { ok: true, actor: { userId, telegramId, level, permissions } };
        }
        return result;
      } catch (error) { return publicFailure(error, reply); }
    });
    direct('/me', null, async (request) => {
      const { userId, telegramId, level, permissions } = request.workspaceSession.actor;
      return { ok: true, actor: { userId, telegramId, level, permissions } };
    });
    const desktopHistory = async (request) => {
      const userId = request.workspaceSession.actor.userId;
      const conversation = await conversationRepository.getOrCreate({ userId, channel: 'desktop',
        externalChatId: request.workspaceSession.deviceId });
      const cursor = request.params?.cursor ?? null;
      const page = await sectionReader.read({ userId, section: 'assistant', conversationId: conversation.id, cursor });
      return { ok: true, paging: page.paging, messages: page.messages };
    };
    direct('/desktop/messages', 'assistant', desktopHistory);
    direct('/desktop/messages/page/:cursor', 'assistant', desktopHistory);
    registerMiniAppSelfRoutes({ route, authorize, requireOrigin: () => { throw accessError('invalid_request'); } },
      { ...services, accessService, sectionReader, conversationRepository, documentUploadMaxBytes,
        authorizeActionSession: actionSessionVerifier });
  });
}

module.exports = { PREFIX, ROUTES, actionSessionVerifier, registerDesktopWorkspaceRoutes };
