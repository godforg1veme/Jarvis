const { z } = require('zod');
const { validateActionArgs } = require('./commandSchemas');

const createSchema = z.object({
  deviceId: z.string().uuid().optional(),
  action: z.string().min(1).max(128),
  args: z.record(z.string(), z.unknown()).default({}),
}).strict();

function commandIdFromParams(params) {
  const value = String(params && params.commandId || '').trim();
  if (!/^[a-f0-9-]{36}$/i.test(value)) {
    const error = new Error('invalid command id');
    error.statusCode = 400;
    error.publicCode = 'INVALID_COMMAND_ID';
    throw error;
  }
  return value;
}

function publicCommand(command) {
  if (!command) return null;
  return {
    id: command.id,
    userId: command.user_id,
    deviceId: command.device_id,
    action: command.action,
    policy: command.policy,
    status: command.status,
    result: command.result || null,
    errorCode: command.error_code || null,
    createdAt: command.created_at || null,
    updatedAt: command.updated_at || null,
    completedAt: command.completed_at || null,
  };
}

function registerCommandRoutes(app, options) {
  const authenticate = options.authenticate;
  const commandService = options.commandService;
  const limiter = options.limiter || null;

  const limit = (request, kind, settings) => {
    if (limiter && typeof limiter.check === 'function') {
      limiter.check(`command:${kind}:${request.device.id}`, settings);
    }
  };

  const requireDevice = async (request) => {
    request.device = await authenticate(request.headers);
  };

  app.post('/v1/desktop/commands', { preHandler: requireDevice, bodyLimit: 128 * 1024 }, async (request, reply) => {
    const input = createSchema.parse(request.body);
    limit(request, 'create', { limit: 20, windowMs: 60000 });
    validateActionArgs(input.action, input.args);
    const result = await commandService.create({
      userId: request.device.user_id,
      deviceId: input.deviceId || request.device.id,
      originDeviceId: request.device.id,
      originChannel: 'desktop',
      action: input.action,
      args: input.args,
    });
    reply.code(result.status === 'awaiting_confirmation' ? 202 : 200);
    return { ok: true, status: result.status, command: publicCommand(result.command), prompt: result.prompt || null };
  });

  app.get('/v1/desktop/commands/:commandId', { preHandler: requireDevice }, async (request) => {
    limit(request, 'read', { limit: 60, windowMs: 60000 });
    const command = await commandService.get({ userId: request.device.user_id, commandId: commandIdFromParams(request.params) });
    return { ok: true, command: publicCommand(command) };
  });

  app.post('/v1/desktop/commands/:commandId/approve', { preHandler: requireDevice }, async (request) => {
    limit(request, 'decision', { limit: 20, windowMs: 60000 });
    const result = await commandService.approve({
      userId: request.device.user_id,
      commandId: commandIdFromParams(request.params),
      originChannel: 'desktop',
      originDeviceId: request.device.id,
    });
    return { ok: true, status: result.status, command: publicCommand(result.command) };
  });

  app.post('/v1/desktop/commands/:commandId/reject', { preHandler: requireDevice }, async (request) => {
    limit(request, 'decision', { limit: 20, windowMs: 60000 });
    const result = await commandService.reject({
      userId: request.device.user_id,
      commandId: commandIdFromParams(request.params),
      originChannel: 'desktop',
      originDeviceId: request.device.id,
    });
    return { ok: true, status: result.status, command: publicCommand(result.command) };
  });
}

module.exports = { commandIdFromParams, publicCommand, registerCommandRoutes };
