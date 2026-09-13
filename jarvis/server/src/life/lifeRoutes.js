const { z } = require('zod');
const { createProjectSchema, feedbackInputSchema, idSchema, timelineQuerySchema, updateProjectSchema } = require('./lifeSchemas');
const { lifeError, publicArea, publicCommitment, publicProject, publicProposal } = require('./lifePublic');

const revisionSchema = z.object({ revision: z.number().int().min(1) }).strict();
const commitmentUpdateSchema = z.object({ revision: z.number().int().min(1), status: z.enum(['completed', 'dismissed']) }).strict();

function registerLifeRoutes(app, options) {
  const authenticate = options.authenticate;
  const limiter = options.limiter;
  const repository = options.repository;
  const projectService = options.projectService;
  const timelineService = options.timelineService;
  const contextService = options.contextService;
  const missionControlService = options.missionControlService;
  const proposalService = options.proposalService;
  const gateway = options.gateway;
  const requireDevice = async (request) => { request.device = await authenticate(request.headers); };
  const checkRead = (device) => limiter.check(`life-read:${device.id}`, { limit: 120, windowMs: 60000 });
  const checkWrite = (device) => limiter.check(`life-write:${device.id}`, { limit: 30, windowMs: 60000 });
  const id = (value) => idSchema.parse(value);

  app.get('/v1/desktop/life/bootstrap', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const data = await projectService.bootstrap({ userId: request.device.user_id });
    return { ok: true, areas: data.areas.map(publicArea), projects: data.projects.map(publicProject) };
  });

  app.get('/v1/desktop/life/timeline', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const query = timelineQuerySchema.parse(request.query || {});
    return { ok: true, ...(await timelineService.list({ userId: request.device.user_id, ...query })) };
  });

  app.get('/v1/desktop/life/projects', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const projects = await repository.listProjects({ userId: request.device.user_id, statuses: ['active', 'paused', 'completed'] });
    return { ok: true, projects: projects.map(publicProject) };
  });

  app.post('/v1/desktop/life/projects', { preHandler: requireDevice, bodyLimit: 16 * 1024 }, async (request, reply) => {
    checkWrite(request.device);
    const project = await projectService.create({ userId: request.device.user_id, input: createProjectSchema.parse(request.body) });
    if (!project) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    reply.code(201);
    return { ok: true, project: publicProject(project) };
  });

  app.patch('/v1/desktop/life/projects/:projectId', { preHandler: requireDevice, bodyLimit: 16 * 1024 }, async (request) => {
    checkWrite(request.device);
    const project = await projectService.update({
      userId: request.device.user_id, projectId: id(request.params.projectId), input: updateProjectSchema.parse(request.body),
    });
    if (!project) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, project: publicProject(project) };
  });

  app.get('/v1/desktop/life/projects/:projectId/context', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const context = await contextService.recover({ userId: request.device.user_id, projectId: id(request.params.projectId) });
    if (!context) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    return { ok: true, context };
  });

  app.get('/v1/desktop/life/mission-control', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    return { ok: true, missionControl: await missionControlService.get({ userId: request.device.user_id }) };
  });

  app.post('/v1/desktop/life/events/:eventId/feedback', { preHandler: requireDevice, bodyLimit: 8 * 1024 }, async (request, reply) => {
    checkWrite(request.device);
    const input = feedbackInputSchema.parse({ ...request.body, targetType: 'event', targetId: id(request.params.eventId) });
    const feedback = await repository.recordFeedback({ userId: request.device.user_id, ...input });
    if (!feedback) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    await gateway.record({
      userId: request.device.user_id, eventType: 'feedback.recorded', occurredAt: new Date(), sourceChannel: 'life_os',
      sourceRef: `feedback:${feedback.id}`, sourceDeviceId: request.device.id,
      deduplicationKey: `feedback:${feedback.id}`, summary: 'Сохранена корректировка Living Timeline',
      structuredData: { feedbackId: feedback.id, targetEventId: input.targetId, kind: input.kind },
      trustLevel: 'user', privacyClass: 'personal',
    });
    reply.code(201);
    return { ok: true, feedback: { id: feedback.id, kind: feedback.kind, targetId: feedback.target_id } };
  });

  app.post('/v1/desktop/life/proposals/:proposalId/confirm', { preHandler: requireDevice, bodyLimit: 1024 }, async (request) => {
    checkWrite(request.device);
    const input = revisionSchema.parse(request.body || {});
    const proposal = await proposalService.confirm({
      userId: request.device.user_id, proposalId: id(request.params.proposalId),
      revision: input.revision, originChannel: 'desktop', originDeviceId: request.device.id,
    });
    if (!proposal) throw lifeError(404, 'LIFE_PROPOSAL_UNAVAILABLE');
    return { ok: true, proposal: publicProposal(proposal) };
  });

  app.post('/v1/desktop/life/proposals/:proposalId/dismiss', { preHandler: requireDevice, bodyLimit: 1024 }, async (request) => {
    checkWrite(request.device);
    const input = revisionSchema.parse(request.body || {});
    const proposal = await proposalService.dismiss({
      userId: request.device.user_id, proposalId: id(request.params.proposalId),
      revision: input.revision, originChannel: 'desktop', originDeviceId: request.device.id,
    });
    if (!proposal) throw lifeError(404, 'LIFE_PROPOSAL_UNAVAILABLE');
    return { ok: true, proposal: publicProposal(proposal) };
  });

  app.patch('/v1/desktop/life/commitments/:commitmentId', { preHandler: requireDevice, bodyLimit: 1024 }, async (request) => {
    checkWrite(request.device);
    const input = commitmentUpdateSchema.parse(request.body);
    const commitment = await repository.updateCommitment({
      userId: request.device.user_id, commitmentId: id(request.params.commitmentId), ...input,
    });
    if (!commitment) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, commitment: publicCommitment(commitment) };
  });
}

module.exports = { registerLifeRoutes };
