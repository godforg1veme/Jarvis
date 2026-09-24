const { z } = require('zod');
const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const bodySchema = z.object({ targetUserId: z.string().uuid() }).strict();
function registerConnectionRoutes(app, { service, requireSession, requireSameOrigin }) {
  app.get('/ops/api/connections', { preHandler: requireSession }, async () => ({
    ok: true,
    profiles: await service.listConnections(),
  }));
  app.post('/ops/api/connections/telegram/:id/reassign', { preHandler: [requireSession, requireSameOrigin] }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params); const { targetUserId } = bodySchema.parse(request.body || {});
    const result = await service.reassignTelegram({ identityId: id, targetUserId, panelSessionId: request.panelSession.id });
    if (!result) { reply.code(404); return { ok: false, code: 'CONNECTION_NOT_FOUND' }; }
    return { ok: true, connection: result };
  });
  app.post('/ops/api/connections/devices/:id/reassign', { preHandler: [requireSession, requireSameOrigin] }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params); const { targetUserId } = bodySchema.parse(request.body || {});
    const result = await service.reassignDevice({ deviceId: id, targetUserId, panelSessionId: request.panelSession.id });
    if (!result) { reply.code(404); return { ok: false, code: 'CONNECTION_NOT_FOUND' }; }
    return { ok: true, reassignment: result };
  });
}

module.exports = { registerConnectionRoutes };
