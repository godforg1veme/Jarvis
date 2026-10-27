const { createHash } = require('node:crypto');
const { PersonalActions } = require('./personalActions');
const { accessError } = require('../access/accessPolicy');

function registerPersonalRoutes({ route, authorize }, services) {
  const actions = new PersonalActions({ accessService: services.accessService, sections: services.personalActionSections || {} });
  const sessionFor = async (request, section, mutation = false) => {
    const session = await authorize(request, { mutation });
    if (!session.actor.permissions.includes(section) || !['documents','devices','life'].includes(section)) throw accessError('forbidden');
    return session;
  };
  route('GET', '/sections/:section/actions', async (request) => {
    const section = request.params.section;
    const result = await actions.describe(await sessionFor(request, section), section);
    if (section === 'documents') result.maxUploadBytes = Math.min(result.maxUploadBytes, 20 * 1024 * 1024);
    return { ok: true, ...result };
  });
  route('GET', '/sections/:section/actions/:kind/:targetId', async (request) => {
    const { section, kind, targetId } = request.params;
    return { ok: true, target: await actions.target(await sessionFor(request, section), section, kind, targetId) };
  });
  route('POST', '/sections/:section/operations', async (request) => {
    const section = request.params.section;
    // Uploads enter exclusively through the bounded binary parser.
    if (request.body?.kind === 'upload') throw accessError('invalid_request');
    return { ok: true, ...await actions.execute(await sessionFor(request, section, true), section, request.body) };
  });
  route('GET', '/sections/:section/operations/:operationId', async (request) => {
    const { section, operationId } = request.params;
    return { ok: true, ...await actions.operation(await sessionFor(request, section), section, operationId) };
  });
  route('POST', '/sections/:section/operations/:operationId/cancel', async (request) => {
    const { section, operationId } = request.params;
    if (request.body !== undefined && (!request.body || Array.isArray(request.body) || Object.keys(request.body).length)) throw accessError('invalid_request');
    return { ok: true, ...await actions.operation(await sessionFor(request, section, true), section, operationId, true) };
  });
  if (actions.available('documents')) route('POST', '/sections/documents/uploads/:operationId', async (request) => {
    const session = await sessionFor(request, 'documents', true);
    const data = request.body;
    if (!Buffer.isBuffer(data) || !data.length) throw accessError('invalid_request');
    let name;
    try { name = decodeURIComponent(request.headers['x-jarvis-file-name'] || ''); } catch { throw accessError('invalid_request'); }
    const command = { operationId: request.params.operationId, kind: 'upload', targetId: null, revision: null,
      input: { name, mediaType: request.headers['x-jarvis-file-type'] || '', byteSize: data.length,
        sha256: createHash('sha256').update(data).digest('hex') } };
    return { ok: true, ...await actions.execute(session, 'documents', command, data) };
  }, { binary: true, bodyLimit: Math.min(Number(services.documentUploadMaxBytes) || 10 * 1024 * 1024, 20 * 1024 * 1024) });
  return actions;
}
module.exports = { registerPersonalRoutes };
