const path = require('node:path');
const fastifyStatic = require('@fastify/static');
async function registerOperationsStatic(app, options = {}) {
  const root = options.root || path.join(__dirname, '..', '..', 'public', 'ops');
  await app.register(fastifyStatic, { root, prefix: '/ops/', decorateReply: false, wildcard: false });
  // @fastify/static owns `/ops/` (including its index route). Keep only the
  // no-slash redirect here; registering both causes Fastify to reject startup.
  app.get('/ops', async (request, reply) => reply.redirect('/ops/', 308));
}
module.exports = { registerOperationsStatic };
