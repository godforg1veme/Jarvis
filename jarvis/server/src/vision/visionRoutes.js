const { z } = require('zod');
const { MAX_FRAME_BYTES, validateVisionFrameMetadata } = require('./visionSchemas');
const { visionError } = require('./visionErrors');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/webp']);
const leaseSchema = z.object({
  durationMs: z.number().int().min(30_000).max(60 * 60 * 1000).optional(),
  sources: z.array(z.unknown()).min(1).max(8),
}).strict();
const requestSchema = z.object({
  sourceId: z.string().min(1).max(128),
  mode: z.enum(['temporal', 'focused']),
  prompt: z.string().max(4000).optional(),
}).strict();

function parseMetadataHeader(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 12_000) {
    throw visionError(400, 'VISION_METADATA_INVALID');
  }
  try {
    return validateVisionFrameMetadata(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch (error) {
    if (error.publicCode) throw error;
    throw visionError(400, 'VISION_METADATA_INVALID');
  }
}

function hasImageMagic(image, contentType) {
  if (contentType === 'image/jpeg') return image.length >= 4 && image[0] === 0xff && image[1] === 0xd8 && image.at(-2) === 0xff && image.at(-1) === 0xd9;
  return image.length >= 12 && image.subarray(0, 4).toString('ascii') === 'RIFF' && image.subarray(8, 12).toString('ascii') === 'WEBP';
}

function publicMemoryRecord(record) {
  return {
    id: record.id,
    frame_id: record.frame_id,
    source_id: record.source_id,
    state: record.state,
    sensitivity: record.sensitivity,
    byte_length: record.byte_length,
    confidence: record.confidence,
    captured_at: record.captured_at,
    expires_at: record.expires_at,
    pinned: record.pinned === true,
    corrected_summary: record.corrected_summary || '',
    created_at: record.created_at,
  };
}

function registerVisionRoutes(app, { authenticate, leaseStore, provider, limiter, memoryService = null }) {
  app.addContentTypeParser([...IMAGE_TYPES], { parseAs: 'buffer' }, (request, body, done) => done(null, body));
  const requireDevice = async (request) => { request.device = await authenticate(request.headers); };

  app.post('/v1/vision/leases', { preHandler: requireDevice, bodyLimit: 32 * 1024 }, async (request, reply) => {
    const input = leaseSchema.parse(request.body);
    limiter.check(`vision-lease:${request.device.id}`, { limit: 10, windowMs: 60_000 });
    reply.code(201);
    return { ok: true, lease: leaseStore.create({ ownerId: request.device.user_id, deviceId: request.device.id, ...input }) };
  });

  app.post('/v1/vision/leases/:leaseId/requests', { preHandler: requireDevice, bodyLimit: 8 * 1024 }, async (request, reply) => {
    const input = requestSchema.parse(request.body);
    limiter.check(`vision-request:${request.device.id}`, { limit: 60, windowMs: 60_000 });
    reply.code(201);
    return { ok: true, request: leaseStore.createRequest({ leaseId: request.params.leaseId, device: request.device, ...input }) };
  });

  app.post('/v1/vision/leases/:leaseId/frames', { preHandler: requireDevice, bodyLimit: MAX_FRAME_BYTES }, async (request) => {
    const type = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) throw visionError(415, 'VISION_CONTENT_TYPE_UNSUPPORTED');
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw visionError(400, 'VISION_FRAME_INVALID');
    const metadata = parseMetadataHeader(request.headers['x-jarvis-vision-metadata']);
    if (metadata.contentType !== type || metadata.byteLength !== request.body.length || !hasImageMagic(request.body, type)) {
      throw visionError(400, 'VISION_FRAME_INVALID');
    }
    limiter.check(`vision-frame-device:${request.device.id}`, { limit: 30, windowMs: 60_000 });
    limiter.check(`vision-frame-lease:${metadata.leaseId}`, { limit: 120, windowMs: 60_000 });
    const accepted = leaseStore.acceptFrame({ leaseId: request.params.leaseId, device: request.device, metadata });
    const observation = await provider.observe({ image: request.body, metadata, prompt: accepted.request.prompt });
    const memory = memoryService ? await memoryService.store({
      userId: request.device.user_id, deviceId: request.device.id, leaseId: metadata.leaseId,
      image: request.body, metadata, observation,
      sensitiveConsent: leaseStore.getSensitiveConsent(accepted.lease, metadata.sourceId),
    }) : null;
    return { ok: true, observation, ...(memory ? { memory } : {}) };
  });

  app.delete('/v1/vision/leases/:leaseId', { preHandler: requireDevice }, async (request) => ({
    ok: true, lease: leaseStore.stop({ leaseId: request.params.leaseId, device: request.device }),
  }));

  if (memoryService) {
    app.get('/v1/vision/memories', { preHandler: requireDevice }, async (request) => ({
      ok: true,
      memories: await memoryService.repository.list({ userId: request.device.user_id, limit: request.query.limit, sourceId: String(request.query.sourceId || '') }),
    }));
    app.get('/v1/vision/memories/:memoryId', { preHandler: requireDevice }, async (request) => {
      const value = await memoryService.read({ userId: request.device.user_id, memoryId: request.params.memoryId });
      if (!value) throw visionError(404, 'VISION_MEMORY_NOT_FOUND');
      return { ok: true, memory: publicMemoryRecord(value.record), observation: value.payload.observation,
        image: { contentType: value.payload.contentType, data: value.payload.image } };
    });
    app.patch('/v1/vision/memories/:memoryId', { preHandler: requireDevice, bodyLimit: 8 * 1024 }, async (request) => {
      const input = z.object({ pinned: z.boolean().optional(), correctedSummary: z.string().max(4000).optional() }).strict()
        .refine((value) => value.pinned !== undefined || value.correctedSummary !== undefined).parse(request.body);
      let result = null;
      if (input.pinned !== undefined) result = await memoryService.repository.setPinned({ userId: request.device.user_id, memoryId: request.params.memoryId, pinned: input.pinned });
      if (input.correctedSummary !== undefined) result = await memoryService.repository.setCorrection({ userId: request.device.user_id, memoryId: request.params.memoryId, summary: input.correctedSummary });
      if (!result) throw visionError(404, 'VISION_MEMORY_NOT_FOUND');
      return { ok: true };
    });
    app.delete('/v1/vision/memories/:memoryId', { preHandler: requireDevice }, async (request) => {
      if (!await memoryService.remove({ userId: request.device.user_id, memoryId: request.params.memoryId })) throw visionError(404, 'VISION_MEMORY_NOT_FOUND');
      return { ok: true };
    });
    app.post('/v1/vision/leases/:leaseId/sensitive-consent', { preHandler: requireDevice, bodyLimit: 8 * 1024 }, async (request) => {
      leaseStore.getAuthorized(request.params.leaseId, request.device);
      const input = z.object({ sourceId: z.string().min(1).max(128), allow: z.boolean() }).strict().parse(request.body);
      const changed = await memoryService.consent({ userId: request.device.user_id, leaseId: request.params.leaseId, sourceId: input.sourceId, allow: input.allow });
      leaseStore.setSensitiveConsent({ leaseId: request.params.leaseId, device: request.device, sourceId: input.sourceId, allow: input.allow });
      return { ok: true, changed };
    });
  }
}

module.exports = { IMAGE_TYPES, hasImageMagic, parseMetadataHeader, publicMemoryRecord, registerVisionRoutes };
