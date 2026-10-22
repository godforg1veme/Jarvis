// Explicit loopback-only design preview of the actual Operations application.
// Never loaded by the server or production build. Mutations are rejected.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { responseFor } = require('./fixtures/operationsPreview.cjs');

(async () => {
  const root = path.resolve(__dirname, '../ops-ui');
  const { createServer } = await import(pathToFileURL(require.resolve('vite', { paths: [root] })).href);
  const server = await createServer({
    root, configFile: path.join(root, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 5188, strictPort: true, open: false },
    plugins: [{
      name: 'local-operations-fixtures',
      transformIndexHtml(html) {
        return html.replace('</body>', '<div style="position:fixed;z-index:100;bottom:8px;right:10px;background:#23272e;color:#d6dce6;border:1px solid #505866;padding:6px 10px;border-radius:4px;font:10px Segoe UI,sans-serif;pointer-events:none">ДЕМО · тестовые данные</div></body>');
      },
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
          if (!pathname.startsWith('/ops/api/')) return next();
          response.setHeader('Cache-Control', 'no-store');
          if (request.method !== 'GET') {
            response.writeHead(403, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'preview_read_only' })); return;
          }
          if (pathname === '/ops/api/stream') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write(': local preview\n\n');
            const timer = setInterval(() => response.write(': preview\n\n'), 15000);
            request.on('close', () => clearInterval(timer)); return;
          }
          const body = responseFor(pathname.slice('/ops/api'.length));
          response.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(body ? { ok: true, ...body } : { error: 'fixture_not_found' }));
        });
      },
    }],
  });
  await server.listen();
  console.log('Operations design preview (synthetic, read-only): http://127.0.0.1:5188/ops/');
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
