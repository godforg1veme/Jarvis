const { z } = require('zod');
const paramsSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), action: z.enum(['start', 'stop', 'restart']) }).strict();
const idempotencySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._~-]+$/);
function registerOperationRoutes(app, { service, requireSession, requireSameOrigin }) {
  app.post('/ops/api/services/:id/actions/:action', { preHandler: [requireSession, requireSameOrigin] }, async (request, reply) => {
    const { id, action } = paramsSchema.parse(request.params);
    const parsed = idempotencySchema.safeParse(request.headers['idempotency-key']);
    if (!parsed.success) { reply.code(400); return { ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' }; }
    try {
      const operation = await service.serviceAction({ sessionId: request.panelSession.id, serviceKey: id, action, idempotencyKey: parsed.data });
      return { ok: true, operation: { id: operation.id, operation: operation.operation, targetKey: operation.target_key, status: operation.status, errorCode: operation.error_code, createdAt: operation.created_at, completedAt: operation.completed_at } };
    } catch (error) {
      if (error.code === 'SERVICE_ACTION_DISABLED') { reply.code(403); return { ok: false, code: error.code }; }
      if (error.code === 'IDEMPOTENCY_CONFLICT') { reply.code(409); return { ok: false, code: error.code }; }
      throw error;
    }
  });
}
module.exports = { registerOperationRoutes };
