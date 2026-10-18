const Fastify = require('fastify');
const { buildRoutingHtmlPage } = require('./vpn/vpnRoutingService');
const { hashToken } = require('./vpn/vpnSubscriptionService');

function isMiniPath(url) {
  const prefix = (url || '').slice(0, 64).replace(/%([0-9a-f]{2})/gi,
    (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return /^\/mini(?:\/|\?|$)/.test(prefix);
}

function subscriptionLogPath(url) {
  // Decode ASCII escapes for classification only; preserve the actual request.
  // This also covers malformed/escaped paths handled by Fastify's default 404.
  const prefix = (url || '').slice(0, 64).replace(/%([0-9a-f]{2})/gi,
    (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const match = /^\/(sub|happ-sub)\//.exec(prefix);
  return match ? `/${match[1]}/:token` : null;
}

function safeRequestLog(request) {
  // A subscription URL is a bearer credential. Drop the complete query too:
  // clients can repeat the credential there under an arbitrary parameter name.
  return {
    method: request.method,
    url: isMiniPath(request.url) ? '/mini/:route' : subscriptionLogPath(request.url) || request.url,
    version: request.headers && request.headers['accept-version'],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket ? request.socket.remotePort : undefined,
  };
}

function safeSubscriptionError(error) {
  // Message, stack, cause and arbitrary provider properties can contain the URL.
  // Keep only a closed diagnostic and a numeric HTTP outcome for this route.
  const statusCode = Number(error && error.statusCode);
  return {
    type: 'SubscriptionRequestError',
    ...(Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
      ? { statusCode } : {}),
  };
}

function loggerOptions(config) {
  if (config.logLevel === 'silent') return false;
  return {
    level: config.logLevel,
    serializers: { req: safeRequestLog },
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
        'jobSecretKey',
        'hhAppToken',
        'hhClientSecret',
        '*.saladApiKey',
        '*.openrouterApiKey',
        '*.openrouterFallbackApiKey',
        '*.geminiApiKey',
        '*.asrApiKey',
        '*.embeddingApiKey',
        '*.visionApiKey',
        '*.visionMemoryKey',
        '*.jobSecretKey',
        '*.hhAppToken',
        '*.hhClientSecret',
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
    // Fastify's default 404/error messages can interpolate the raw URL outside
    // the req serializer. Emit only closed lifecycle messages for this prefix.
    logController: new Fastify.LogController({
      disableRequestLogging: (request) => isMiniPath(request.url) || Boolean(subscriptionLogPath(request.url)),
    }),
  });

  app.addHook('onRequest', async (request) => {
    if (isMiniPath(request.url) || subscriptionLogPath(request.url)) request.log.info({ req: request }, 'incoming request');
  });
  app.addHook('onResponse', async (request, reply) => {
    if (isMiniPath(request.url) || subscriptionLogPath(request.url)) {
      request.log.info({ res: reply, responseTime: reply.elapsedTime }, 'request completed');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    const opsAsset = request.raw.url && request.raw.url.startsWith('/ops/');
    const miniAsset = config.miniAppEnabled && isMiniPath(request.raw.url);
    if (miniAsset) reply.removeHeader('X-Frame-Options');
    const isHtmlLanding = request.raw.url && (
      request.raw.url.startsWith('/happ-routing') ||
      request.raw.url.startsWith('/happ-sub/')
    );
    reply.header('Content-Security-Policy', miniAsset
      ? "default-src 'none'; script-src 'self' https://telegram.org/js/telegram-web-app.js; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.web.telegram.org; base-uri 'none'; object-src 'none'; form-action 'self'"
      : opsAsset
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

  const subscriptionLogOptions = { logSerializers: { err: safeSubscriptionError } };
  app.get('/sub/:token', subscriptionLogOptions, async (request, reply) => {
    const svc = options.vpnSubscriptionService || app.vpnSubscriptionService;
    if (!svc) {
      reply.code(503).type('application/json').send({ error: 'SERVICE_UNAVAILABLE' });
      return;
    }
    const token = request.params.token;
    const userAgent = request.headers['user-agent'] || '';
    const format = request.query && request.query.format;
    const result = await svc.resolveSubscription(token, { userAgent, format });
    for (const [name, value] of Object.entries(result.headers || {})) reply.header(name, value);
    reply.code(result.status).type(result.contentType).send(result.body);
  });

  app.get('/happ-sub/:token', subscriptionLogOptions, async (request, reply) => {
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
    request.log.error({
      err: isMiniPath(request.url) || subscriptionLogPath(request.url) ? safeSubscriptionError(error) : error,
      requestId: request.id,
    }, 'request failed');
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
