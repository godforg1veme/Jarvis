const { z } = require('zod');
const { createProjectSchema, feedbackInputSchema, idSchema, timelineQuerySchema, updateProjectSchema } = require('./lifeSchemas');
const { modeSelectionSchema } = require('./modes/lifeModeSchemas');
const {
  createFamilyGrantSchema, createPersonProjectLinkSchema, createPersonSchema,
  createRelationshipSchema, revokeFamilyGrantSchema, updatePersonSchema,
} = require('./people/peopleSchemas');
const { PREFERENCE_KEYS, preferenceMutationSchema, preferenceRevisionSchema } = require('./preferences/lifePreferenceSchemas');
const {
  lifeError, publicArea, publicCommitment, publicFamilyGrant, publicMode, publicPerson,
  publicPersonProjectLink, publicPreference, publicProject, publicProposal, publicRelationship,
} = require('./lifePublic');

const revisionSchema = z.object({ revision: z.number().int().min(1) }).strict();
const commitmentUpdateSchema = z.object({ revision: z.number().int().min(1), status: z.enum(['completed', 'dismissed']) }).strict();
const preferenceKeySchema = z.enum(PREFERENCE_KEYS);
const queryBooleanSchema = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const peopleQuerySchema = z.object({ includeArchived: queryBooleanSchema }).strict();
const relationshipQuerySchema = z.object({ personId: idSchema.optional() }).strict();
const personProjectQuerySchema = z.object({ projectId: idSchema.optional(), personId: idSchema.optional() }).strict();
const grantsQuerySchema = z.object({ memberUserId: idSchema.optional(), includeInactive: queryBooleanSchema }).strict();

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
  const modeService = options.modeService || null;
  const preferenceService = options.preferenceService || null;
  const feedbackAggregator = options.feedbackAggregator || null;
  const peopleService = options.peopleService || null;
  const familyAccessService = options.familyAccessService || null;
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

  app.get('/v1/desktop/life/mode', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    return { ok: true, mode: publicMode(await modeService.get({ userId: request.device.user_id })) };
  });

  app.put('/v1/desktop/life/mode', { preHandler: requireDevice, bodyLimit: 4096 }, async (request) => {
    checkWrite(request.device);
    const mode = await modeService.setManual({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      input: modeSelectionSchema.parse(request.body),
    });
    if (!mode) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, mode: publicMode(mode) };
  });

  app.post('/v1/desktop/life/mode/accept-suggestion', { preHandler: requireDevice, bodyLimit: 4096 }, async (request) => {
    checkWrite(request.device);
    const mode = await modeService.acceptSuggestion({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      input: modeSelectionSchema.parse(request.body),
    });
    if (!mode) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, mode: publicMode(mode) };
  });

  app.get('/v1/desktop/life/preferences', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const preferences = await preferenceService.list({ userId: request.device.user_id });
    return { ok: true, preferences: preferences.map(publicPreference) };
  });

  app.put('/v1/desktop/life/preferences/:key', { preHandler: requireDevice, bodyLimit: 8192 }, async (request) => {
    checkWrite(request.device);
    const input = preferenceMutationSchema.parse(request.body);
    const preference = await preferenceService.set({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      key: preferenceKeySchema.parse(request.params.key), ...input,
    });
    if (!preference) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, preference: publicPreference(preference) };
  });

  app.post('/v1/desktop/life/preferences/:key/reset', { preHandler: requireDevice, bodyLimit: 1024 }, async (request) => {
    checkWrite(request.device);
    const input = preferenceRevisionSchema.parse(request.body);
    const preference = await preferenceService.reset({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      key: preferenceKeySchema.parse(request.params.key), revision: input.revision,
    });
    if (!preference) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, preference: publicPreference(preference) };
  });

  app.delete('/v1/desktop/life/preferences/:key', { preHandler: requireDevice, bodyLimit: 1024 }, async (request) => {
    checkWrite(request.device);
    const input = preferenceRevisionSchema.parse(request.body);
    const removed = await preferenceService.remove({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      key: preferenceKeySchema.parse(request.params.key), revision: input.revision,
    });
    if (!removed) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, removed: true };
  });

  app.get('/v1/desktop/life/people', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const query = peopleQuerySchema.parse(request.query || {});
    const people = await peopleService.list({ userId: request.device.user_id, ...query });
    return { ok: true, people: people.map(publicPerson) };
  });

  app.post('/v1/desktop/life/people', { preHandler: requireDevice, bodyLimit: 8192 }, async (request, reply) => {
    checkWrite(request.device);
    const person = await peopleService.create({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      input: createPersonSchema.parse(request.body),
    });
    if (!person) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    reply.code(201);
    return { ok: true, person: publicPerson(person) };
  });

  app.patch('/v1/desktop/life/people/:personId', { preHandler: requireDevice, bodyLimit: 8192 }, async (request) => {
    checkWrite(request.device);
    const person = await peopleService.update({
      userId: request.device.user_id, personId: id(request.params.personId),
      sourceDeviceId: request.device.id, input: updatePersonSchema.parse(request.body),
    });
    if (!person) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, person: publicPerson(person) };
  });

  app.get('/v1/desktop/life/relationships', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const query = relationshipQuerySchema.parse(request.query || {});
    const relationships = await peopleService.listRelationships({ userId: request.device.user_id, ...query });
    return { ok: true, relationships: relationships.map(publicRelationship) };
  });

  app.post('/v1/desktop/life/relationships', { preHandler: requireDevice, bodyLimit: 4096 }, async (request, reply) => {
    checkWrite(request.device);
    const relationship = await peopleService.createRelationship({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      input: createRelationshipSchema.parse(request.body),
    });
    if (!relationship) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    reply.code(201);
    return { ok: true, relationship: publicRelationship(relationship) };
  });

  app.get('/v1/desktop/life/person-project-links', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const query = personProjectQuerySchema.parse(request.query || {});
    const links = await peopleService.listProjectLinks({ userId: request.device.user_id, ...query });
    return { ok: true, links: links.map(publicPersonProjectLink) };
  });

  app.post('/v1/desktop/life/person-project-links', { preHandler: requireDevice, bodyLimit: 4096 }, async (request, reply) => {
    checkWrite(request.device);
    const link = await peopleService.createProjectLink({
      userId: request.device.user_id, input: createPersonProjectLinkSchema.parse(request.body),
    });
    if (!link) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    reply.code(201);
    return { ok: true, link: publicPersonProjectLink(link) };
  });

  app.get('/v1/desktop/life/family-grants', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    const query = grantsQuerySchema.parse(request.query || {});
    const grants = await familyAccessService.listOwned({ userId: request.device.user_id, ...query });
    return { ok: true, grants: grants.map(publicFamilyGrant) };
  });

  app.post('/v1/desktop/life/family-grants', { preHandler: requireDevice, bodyLimit: 4096 }, async (request, reply) => {
    checkWrite(request.device);
    const grant = await familyAccessService.create({
      userId: request.device.user_id, sourceDeviceId: request.device.id,
      input: createFamilyGrantSchema.parse(request.body),
    });
    if (!grant) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    reply.code(201);
    return { ok: true, grant: publicFamilyGrant(grant) };
  });

  app.delete('/v1/desktop/life/family-grants/:grantId', { preHandler: requireDevice, bodyLimit: 1024 }, async (request) => {
    checkWrite(request.device);
    const input = revokeFamilyGrantSchema.parse(request.body);
    const grant = await familyAccessService.revoke({
      userId: request.device.user_id, grantId: id(request.params.grantId),
      sourceDeviceId: request.device.id, revision: input.revision,
    });
    if (!grant) throw lifeError(409, 'LIFE_REVISION_CONFLICT');
    return { ok: true, grant: publicFamilyGrant(grant) };
  });

  app.get('/v1/desktop/life/family/shared', { preHandler: requireDevice }, async (request) => {
    checkRead(request.device);
    return { ok: true, shared: await familyAccessService.listShared({ memberUserId: request.device.user_id }) };
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
    if (feedbackAggregator) await feedbackAggregator.aggregate({ userId: request.device.user_id }).catch(() => null);
    reply.code(201);
    return { ok: true, feedback: { id: feedback.id, kind: feedback.kind, targetId: feedback.target_id } };
  });

  app.post('/v1/desktop/life/proposals/:proposalId/feedback', { preHandler: requireDevice, bodyLimit: 8 * 1024 }, async (request, reply) => {
    checkWrite(request.device);
    const input = feedbackInputSchema.parse({ ...request.body, targetType: 'proposal', targetId: id(request.params.proposalId) });
    const feedback = await repository.recordFeedback({ userId: request.device.user_id, ...input });
    if (!feedback) throw lifeError(404, 'LIFE_SCOPE_NOT_FOUND');
    await gateway.record({
      userId: request.device.user_id, eventType: 'feedback.recorded', occurredAt: new Date(), sourceChannel: 'life_os',
      sourceRef: `feedback:${feedback.id}`, sourceDeviceId: request.device.id,
      deduplicationKey: `feedback:${feedback.id}`, summary: 'Сохранена оценка предложения Life OS',
      structuredData: { feedbackId: feedback.id, targetProposalId: input.targetId, kind: input.kind },
      trustLevel: 'user', privacyClass: 'personal',
    });
    if (feedbackAggregator) await feedbackAggregator.aggregate({ userId: request.device.user_id }).catch(() => null);
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
