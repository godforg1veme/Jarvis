const Fastify = require('fastify');
const { buildRoutingHtmlPage } = require('./vpn/vpnRoutingService');
const { hashToken } = require('./vpn/vpnSubscriptionService');

function loggerOptions(config) {
  if (config.logLevel === 'silent') return false;
  return {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'telegramBotToken',
        'databaseUrl',
        'saladApiKey',
        'openrouterApiKey',
        'openrouterFallbackApiKey',
        'geminiApiKey',
        'asrApiKey',
        'embeddingApiKey',
        'visionApiKey',
        'visionMemoryKey',
        '*.saladApiKey',
        '*.openrouterApiKey',
        '*.openrouterFallbackApiKey',
        '*.geminiApiKey',
        '*.asrApiKey',
        '*.embeddingApiKey',
        '*.visionApiKey',
        '*.visionMemoryKey',
        '*.token',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  };
}

function buildApp(options = {}) {
  const config = options.config;
  if (!config) throw new Error('buildApp requires config');

  const readinessChecks = Array.isArray(options.readinessChecks) ? options.readinessChecks : [];
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    requestIdHeader: false,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    const opsAsset = request.raw.url && request.raw.url.startsWith('/ops/');
    const isHtmlLanding = request.raw.url && (
      request.raw.url.startsWith('/happ-routing') ||
      request.raw.url.startsWith('/happ-sub/')
    );
    reply.header('Content-Security-Policy', opsAsset
      ? "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
      : isHtmlLanding
      ? "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
      : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (config.nodeEnv === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.get('/health/live', async () => ({ ok: true, service: 'jarvis-family-server' }));
  app.get('/happ-routing', async (request, reply) => {
    reply.type('text/html; charset=utf-8').send(buildRoutingHtmlPage());
  });

  app.get('/sub/:token', async (request, reply) => {
    const svc = options.vpnSubscriptionService || app.vpnSubscriptionService;
    if (!svc) {
      reply.code(503).type('application/json').send({ error: 'SERVICE_UNAVAILABLE' });
      return;
    }
    const token = request.params.token;
    const userAgent = request.headers['user-agent'] || '';
    const format = request.query && request.query.format;
    const result = await svc.resolveSubscription(token, { userAgent, format });
    reply.code(result.status).type(result.contentType).send(result.body);
  });

  app.get('/happ-sub/:token', async (request, reply) => {
    const svc = options.vpnSubscriptionService || app.vpnSubscriptionService;
    if (!svc) {
      reply.code(503).type('text/html; charset=utf-8').send('<h1>503 Сервис недоступен</h1>');
      return;
    }
    const token = request.params.token;
    const tokenHash = hashToken(token);
    const sub = await svc.repository?.findActiveByTokenHash(tokenHash);
    if (!sub) {
      reply.code(404).type('text/html; charset=utf-8').send('<h1>404 Подписка не найдена</h1>');
      return;
    }
    reply.type('text/html; charset=utf-8').send(svc.renderHappLandingHtml({ token, label: sub.label }));
  });
  app.get('/health/ready', async (request, reply) => {
    const checks = [];
    for (const check of readinessChecks) {
      try {
        const result = await check();
        checks.push({ name: result.name, ok: result.ok !== false, detail: result.detail || '' });
      } catch {
        checks.push({ name: check.name || 'unknown', ok: false, detail: 'check failed' });
      }
    }
    const ok = checks.every((check) => check.ok);
    if (!ok) reply.code(503);
    return { ok, checks };
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, 'request failed');
    const statusCode = error && error.name === 'ZodError'
      ? 400
      : Number(error.statusCode) >= 400 && Number(error.statusCode) < 500
      ? Number(error.statusCode)
      : 500;
    reply.code(statusCode).send({
      ok: false,
      error: statusCode === 500 ? 'Internal server error' : 'Request failed',
      ...(typeof error.publicCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.publicCode)
        ? { code: error.publicCode }
        : {}),
      requestId: request.id,
    });
  });

  return app;
}

module.exports = {
  buildApp,
  loggerOptions,
};
