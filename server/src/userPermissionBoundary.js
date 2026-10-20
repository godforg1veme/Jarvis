// Shared, server-side gates. The caller's role never changes a resource's owner.
function permissionError() {
  const error = new Error('Access unavailable');
  error.statusCode = 403;
  error.publicCode = 'PERMISSION_DENIED';
  return error;
}

function protectService(service, accessService, permission) {
  if (!service || !accessService) return service;
  return new Proxy(service, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return async function guarded(...args) {
        const userId = args[0]?.userId || args[0]?.scope?.userId;
        if (userId && !await accessService.allows(userId, permission)) throw permissionError();
        return value.apply(target, args);
      };
    },
  });
}

function desktopPermission(request) {
  // Fastify resolves escaped static segments before routing. Use that canonical
  // route so percent-encoding cannot make a protected handler look unrelated.
  let pathname = request.routeOptions?.url;
  if (!pathname) {
    try { pathname = decodeURIComponent(request.url.split('?', 1)[0]); }
    catch { return null; }
  }
  if (pathname.startsWith('/v1/vision/')) return ['devices', 'memory'];
  if (!pathname.startsWith('/v1/desktop/') || ['/v1/desktop/pair', '/v1/desktop/session'].includes(pathname)) return null;
  if (pathname.startsWith('/v1/desktop/life')) return 'life';
  if (pathname.startsWith('/v1/desktop/requests/')) return 'assistant';
  if (['/v1/desktop/messages', '/v1/desktop/voice', '/v1/desktop/voice/transcribe'].includes(pathname)) return 'assistant';
  return 'devices';
}

function registerDesktopPermissionBoundary(app, { accessService, authenticate }) {
  app.addHook('preHandler', async (request) => {
    const permissions = desktopPermission(request);
    if (!permissions) return;
    const device = await authenticate(request.headers);
    const actor = await accessService.getAccessForUser(device.user_id || device.userId);
    const required = Array.isArray(permissions) ? permissions : [permissions];
    if (!actor || actor.blocked || !required.every((id) => actor.permissions.includes(id))) throw permissionError();
  });
}

module.exports = { permissionError, protectService, desktopPermission, registerDesktopPermissionBoundary };
