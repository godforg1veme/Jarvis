const fs = require('node:fs/promises');
const path = require('node:path');

// Deliberately not a filesystem wildcard. Neither preview files nor node_modules
// can be reached through this production route.
const ASSETS = Object.freeze({
  'index.html': 'text/html; charset=utf-8',
  'job-connect.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'jobConnect.js': 'text/javascript; charset=utf-8',
  'jobConnection.js': 'text/javascript; charset=utf-8',
  'jobResumes.js': 'text/javascript; charset=utf-8',
  'jobResumes.css': 'text/css; charset=utf-8',
  'api.js': 'text/javascript; charset=utf-8',
  'admin.js': 'text/javascript; charset=utf-8',
  'core.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'vendor/three.module.js': 'text/javascript; charset=utf-8',
  'vendor/three.core.js': 'text/javascript; charset=utf-8',
  'vendor/RoomEnvironment.js': 'text/javascript; charset=utf-8',
});

function registerMiniAppAssets(app, { root = path.join(__dirname, '../public/mini') } = {}) {
  const serve = (name) => async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const data = await fs.readFile(path.join(root, name));
      return reply.type(ASSETS[name]).send(data);
    } catch {
      return reply.code(503).send({ ok: false, code: 'MINI_ASSETS_UNAVAILABLE' });
    }
  };
  app.get('/mini', async (_request, reply) => reply.redirect('/mini/'));
  app.get('/mini/', serve('index.html'));
  app.get('/mini/job-connect/', serve('job-connect.html'));
  for (const name of Object.keys(ASSETS)) app.get(`/mini/${name}`, serve(name));
}

module.exports = { registerMiniAppAssets, ASSETS };
