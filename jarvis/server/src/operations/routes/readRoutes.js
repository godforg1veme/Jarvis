const crypto = require('node:crypto');
const { z } = require('zod');
const { normalizeOperationalLogs } = require('../collectors/logCollector');

const serviceParamsSchema = z.object({ id: z.string().regex(/^(?:host|[a-z][a-z0-9_-]{0,63})$/) }).strict();
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();
const metricsQuerySchema = z.object({ hours: z.coerce.number().int().min(1).max(24).default(6), limit: z.coerce.number().int().min(1).max(1000).default(500) }).strict();
const logsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).strict();

function agentRequest(client, operation, args = {}) {
  return client.request({ version: 1, requestId: crypto.randomUUID(), operation, arguments: args, sentAt: new Date().toISOString() });
}

function redactOperationalLog(value) {
  return String(value || '')
    .replace(/("(?:authorization|token|password|secret|api[_-]?key|prompt|messages?|content|body)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, 'https://[REDACTED]@')
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED]')
    .replace(/authorization\s*[=:]\s*bearer\s+\S+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/(authorization|token|password|secret|api[_-]?key)(\s*[=:]\s*)\S+/gi, '$1$2[REDACTED]')
    .replace(/(bot|bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [REDACTED]')
    .replace(/https:\/\/api\.telegram\.org\/file\/bot[^/\s]+/gi, 'https://api.telegram.org/file/bot[REDACTED]')
    .slice(0, 32000);
}

function registerReadRoutes(app, { repository, hostId, requireSession, client, sseHub }) {
  app.get('/ops/api/inventory', { preHandler: requireSession }, async () => {
    const response = await agentRequest(client, 'inventory.snapshot');
    if (response.result.state !== 'succeeded') return { ok: true, inventory: { items: [], unavailable: ['docker', 'systemd'] } };
    const inventory = z.object({ items: z.array(z.object({ name: z.string().max(160), type: z.enum(['docker', 'systemd']), state: z.string().max(40) }).strict()).max(100), unavailable: z.array(z.enum(['docker', 'systemd'])).max(2) }).strict().parse(response.result.data);
    return { ok: true, inventory };
  });
  app.get('/ops/api/checks', { preHandler: requireSession }, async () => ({ ok: true, checks: await repository.healthChecks(hostId) }));
  app.get('/ops/api/overview', { preHandler: requireSession }, async () => ({ ok: true, overview: await repository.overview(hostId) }));
  app.get('/ops/api/services', { preHandler: requireSession }, async () => ({ ok: true, services: await repository.listServices(hostId) }));
  app.get('/ops/api/services/:id', { preHandler: requireSession }, async (request, reply) => {
    const { id } = serviceParamsSchema.parse(request.params);
    if (id === 'host') return { ok: true, service: { key: 'host', name: 'Jarvis VPS', type: 'host' } };
    const service = await repository.serviceByKey(hostId, id);
    if (!service) { reply.code(404); return { ok: false, code: 'SERVICE_NOT_FOUND' }; }
    return { ok: true, service };
  });
  app.get('/ops/api/services/:id/metrics', { preHandler: requireSession }, async (request, reply) => {
    const { id } = serviceParamsSchema.parse(request.params);
    const query = metricsQuerySchema.parse(request.query || {});
    const service = id === 'host' ? null : await repository.serviceByKey(hostId, id);
    if (id !== 'host' && !service) { reply.code(404); return { ok: false, code: 'SERVICE_NOT_FOUND' }; }
    const since = new Date(Date.now() - (query.hours * 60 * 60 * 1000));
    return { ok: true, metrics: await repository.metrics({ hostId, serviceId: service && service.id, since, limit: query.limit }) };
  });
  app.get('/ops/api/services/:id/logs', { preHandler: requireSession }, async (request, reply) => {
    const { id } = serviceParamsSchema.parse(request.params);
    if (id === 'host') { reply.code(400); return { ok: false, code: 'HOST_LOGS_UNAVAILABLE' }; }
    const query = logsQuerySchema.parse(request.query || {});
    const service = await repository.serviceByKey(hostId, id);
    if (!service) { reply.code(404); return { ok: false, code: 'SERVICE_NOT_FOUND' }; }
    const history = await repository.logs(hostId, service.id, query.limit);
    if (history.length) return { ok: true, state: 'succeeded', logs: history.map((entry) => `${new Date(entry.observedAt).toISOString()} ${entry.message}`) };
    const response = await agentRequest(client, 'service.logs.read', { serviceId: id, maxLines: query.limit });
    const output = response.result.data && response.result.data.output;
    const entries = normalizeOperationalLogs(output);
    return { ok: true, state: response.result.state,
      logs: entries.slice(-query.limit).map((entry) => `${new Date(entry.observedAt).toISOString()} ${entry.message}`) };
  });
  app.get('/ops/api/incidents', { preHandler: requireSession }, async (request) => {
    const { limit } = listQuerySchema.parse(request.query || {}); return { ok: true, incidents: await repository.incidents(hostId, limit) };
  });
  app.get('/ops/api/events', { preHandler: requireSession }, async (request) => {
    const { limit } = listQuerySchema.parse(request.query || {}); return { ok: true, events: await repository.events(hostId, limit) };
  });
  app.get('/ops/api/backups', { preHandler: requireSession }, async (request) => {
    const { limit } = listQuerySchema.parse(request.query || {}); return { ok: true, backups: await repository.backups(hostId, limit) };
  });
  app.get('/ops/api/parser', { preHandler: requireSession }, async (request) => {
    const { limit } = listQuerySchema.parse(request.query || {});
    const [service, results] = await Promise.all([repository.serviceByKey(hostId, 'telegram-parser'), repository.parserResults(hostId, limit)]);
    return { ok: true, parser: { service, results } };
  });
  app.get('/ops/api/stream', { preHandler: requireSession }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    sseHub.subscribe(request.panelSession.id, reply.raw, String(request.headers['last-event-id'] || ''));
  });
}

module.exports = { redactOperationalLog, registerReadRoutes };
