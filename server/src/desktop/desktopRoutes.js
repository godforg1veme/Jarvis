const { z } = require('zod');

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const CLIENT_MESSAGE_ID = /^[a-zA-Z0-9_.:-]{1,128}$/;
const ALLOWED_AUDIO_TYPES = new Set(['audio/wav', 'audio/x-wav', 'application/octet-stream']);

const pairingSchema = z.object({
  pairingCode: z.string().min(8).max(64),
  capabilities: z.object({
    wakeWord: z.boolean().optional(),
    localTts: z.boolean().optional(),
    localActions: z.array(z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/)).max(100).optional(),
    protocolVersion: z.number().int().min(1).max(100).optional(),
  }).strict().optional(),
}).strict();

const messageSchema = z.object({
  clientMessageId: z.string().regex(CLIENT_MESSAGE_ID),
  text: z.string().min(1).max(10000),
}).strict();

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    capabilities: device.capabilities || {},
    lastSeenAt: device.last_seen_at || null,
  };
}

function publicError(statusCode, code) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.publicCode = code;
  return error;
}

function readAudioMetadata(request) {
  const mimeType = String(request.headers['x-jarvis-audio-mime'] || request.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const clientMessageId = String(request.headers['x-jarvis-client-message-id'] || '').trim();
  if (!CLIENT_MESSAGE_ID.test(clientMessageId)) throw publicError(400, 'INVALID_CLIENT_MESSAGE_ID');
  if (!ALLOWED_AUDIO_TYPES.has(mimeType)) throw publicError(415, 'UNSUPPORTED_AUDIO');
  if (!Buffer.isBuffer(request.body) || request.body.length === 0 || request.body.length > MAX_AUDIO_BYTES) {
    throw publicError(400, 'INVALID_AUDIO');
  }
  return { clientMessageId, mimeType, audio: request.body };
}

function registerDesktopRoutes(app, options) {
  const authenticate = options.authenticate;
  const deviceService = options.deviceService;
  const messageService = options.messageService;
  const asr = options.asr;
  const limiter = options.limiter;

  app.addContentTypeParser(['audio/wav', 'audio/x-wav', 'application/octet-stream'], { parseAs: 'buffer' }, (request, body, done) => {
    done(null, body);
  });

  const requireDevice = async (request) => {
    request.device = await authenticate(request.headers);
  };

  app.post('/v1/desktop/pair', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const input = pairingSchema.parse(request.body);
    const device = await deviceService.claimPairing({
      code: input.pairingCode,
      capabilities: input.capabilities || {},
    });
    if (!device) throw publicError(401, 'PAIRING_UNAVAILABLE');
    reply.code(201);
    return { ok: true, device: publicDevice(device), token: device.token };
  });

  app.get('/v1/desktop/device', { preHandler: requireDevice }, async (request) => ({
    ok: true,
    device: publicDevice(request.device),
  }));

  app.post('/v1/desktop/messages', { preHandler: requireDevice, bodyLimit: 32 * 1024 }, async (request) => {
    const input = messageSchema.parse(request.body);
    limiter.check(`message:${request.device.id}`, { limit: 30, windowMs: 60000 });
    const response = await messageService.handle({
      device: request.device,
      clientMessageId: input.clientMessageId,
      kind: 'text',
      resolveContent: async () => ({ content: input.text }),
    });
    return { ok: true, ...response };
  });

  app.post('/v1/desktop/voice', { preHandler: requireDevice, bodyLimit: MAX_AUDIO_BYTES }, async (request) => {
    const input = readAudioMetadata(request);
    limiter.check(`voice:${request.device.id}`, { limit: 10, windowMs: 60000 });
    const response = await messageService.handle({
      device: request.device,
      clientMessageId: input.clientMessageId,
      kind: 'voice',
      resolveContent: async () => {
        const transcription = await asr.transcribe({
          audio: input.audio,
          mimeType: input.mimeType,
          languageHint: 'ru',
          requestId: request.id,
        });
        return { content: transcription.text, transcription };
      },
    });
    return { ok: true, ...response };
  });

  app.post('/v1/desktop/voice/transcribe', { preHandler: requireDevice, bodyLimit: MAX_AUDIO_BYTES }, async (request) => {
    const input = readAudioMetadata(request);
    limiter.check(`voice-transcribe:${request.device.id}`, { limit: 10, windowMs: 60000 });
    const transcription = await asr.transcribe({
      audio: input.audio, mimeType: input.mimeType, languageHint: 'ru', requestId: request.id,
    });
    return { ok: true, transcript: transcription.text, transcription };
  });
}

module.exports = {
  ALLOWED_AUDIO_TYPES,
  CLIENT_MESSAGE_ID,
  MAX_AUDIO_BYTES,
  publicDevice,
  readAudioMetadata,
  registerDesktopRoutes,
};
