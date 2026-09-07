const { validateDeviceSessionMessage } = require('./sessionProtocol');

function send(socket, message) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
}

function createDeviceSessionHandler(options) {
  const authenticate = options.authenticate;
  const repository = options.repository;
  const sessionRegistry = options.sessionRegistry || null;
  const commandService = options.commandService || null;
  const logger = options.logger || null;

  return async function handle(socket) {
    let device = null;
    let authenticating = false;
    let authenticationTimer = setTimeout(() => {
      try { socket.close(1008, 'authentication timeout'); } catch (_) {}
    }, 10000);

    socket.on('message', async (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        const message = validateDeviceSessionMessage(parsed);

        if (!device) {
          if (authenticating || message.type !== 'device.hello') {
            throw new Error('device authentication is required');
          }
          authenticating = true;
          try {
            // Browser and Electron WebSocket APIs cannot safely attach custom
            // Authorization headers. The credential therefore crosses only the
            // already-TLS-protected WebSocket payload and is never placed in a URL.
            const authenticated = await authenticate({ authorization: `Bearer ${message.payload.token}` });
            if (message.payload.deviceId !== authenticated.id) throw new Error('device id mismatch');
            const online = await repository.markOnline({ userId: authenticated.user_id, deviceId: authenticated.id });
            if (!online) throw new Error('device became unavailable');
            device = online;
            const unregister = sessionRegistry ? sessionRegistry.register(device, socket) : () => {};
            socket.once('close', unregister);
            clearTimeout(authenticationTimer);
            authenticationTimer = null;
            send(socket, { version: 1, type: 'device.welcome', payload: { deviceId: device.id, status: 'online' } });
          } finally {
            authenticating = false;
          }
          return;
        }

        if (sessionRegistry && !sessionRegistry.isCurrent(device.id, socket)) {
          socket.close(1008, 'session revoked');
          return;
        }
        if (message.type === 'device.hello' && message.payload.deviceId !== device.id) {
          throw new Error('device id mismatch');
        }
        if (message.type === 'device.capabilities') {
          await repository.setCapabilities({
            userId: device.user_id,
            deviceId: device.id,
            capabilities: { actions: message.payload.actions },
          });
        }
        if (message.type === 'device.heartbeat' || message.type === 'device.hello') {
          const online = await repository.markOnline({ userId: device.user_id, deviceId: device.id });
          if (!online) { socket.close(1008, 'device revoked'); return; }
        }
        if (message.type === 'command.result') {
          if (!commandService) throw new Error('command service is unavailable');
          await commandService.handleResult({
            device,
            commandId: message.payload.commandId,
            result: message.payload.result,
          });
        }
      } catch (error) {
        // Do not log raw frames or errors carrying validation detail: a first
        // hello frame necessarily contains a device credential.
        if (logger) logger.warn({ deviceId: device && device.id }, 'invalid desktop session message');
        if (!device) {
          try { socket.close(1008, 'authentication failed'); } catch (_) {}
          return;
        }
        send(socket, { version: 1, type: 'server.error', payload: { code: 'INVALID_SESSION_MESSAGE', message: 'Invalid device message.' } });
      }
    });

    socket.on('close', () => {
      if (authenticationTimer) clearTimeout(authenticationTimer);
      authenticationTimer = null;
      if (!device) return;
      const current = !sessionRegistry || sessionRegistry.isCurrent(device.id, socket);
      if (sessionRegistry) sessionRegistry.unregister(device.id, socket);
      if (!current) return;
      void repository.markOffline({ userId: device.user_id, deviceId: device.id })
        .catch((error) => logger && logger.warn({ deviceId: device.id, err: error }, 'failed to mark device offline'));
    });
  };
}

async function registerDeviceSessionRoute(app, options) {
  const websocket = require('@fastify/websocket');
  await app.register(websocket);
  const handler = createDeviceSessionHandler(options);
  app.get('/v1/desktop/session', { websocket: true }, (socket) => handler(socket));
}

module.exports = { createDeviceSessionHandler, registerDeviceSessionRoute };
